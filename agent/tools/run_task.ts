import { defineWorkflowTool, type AgentInput } from "eve/tools";
import { z } from "zod";
import { semanticChangeSchema } from "../../lib/semantic-change";
import { beginTask, routeTask, taskContext, workerState, advance, saveProposal, uploadTaskPolicy, requestTaskGame, evaluationContext, taskFailure } from "../lib/tasks/steps";
import { campaignContext,adoptCampaign } from '../lib/tasks/campaign-steps';
import { candidateProposalSchema } from '../../lib/campaigns/candidate-schema';
import { taskErrorMessage } from '../../lib/tasks/failure';

import { humanSummarySchema } from "../../lib/tasks/report-schema";
import { humanCommunicationInstructions } from "../../lib/tasks/communication";

const selectionSchema = z.object({ selected: z.number().int().min(-1).max(1), reason: z.string().min(8).max(2000) });
const evaluationSchema = z.object({ satisfied: z.boolean(), humanSummary: humanSummarySchema.optional(), summary: z.string().min(8).max(4000), evidence: z.array(z.string()).min(1).max(20), needsInput: z.string().max(2000) });

export default defineWorkflowTool({
  availableInSubagents: false,
  description: "Execute a task dispatched by the internal task scheduler. Do not call from a student conversation; use start_task instead.",
  inputSchema: z.object({ task_id: z.uuid() }),
  execution: "background",
  async execute({ task_id }, ctx) {
    "use workflow";
    let task = await beginTask(ctx, task_id);
    if (!task) return { status: "already_claimed_or_stopped" };
    const execution = task.execution_key!;
    try {
      if(task.context?.role==='candidate'&&task.context.campaignId){
        const key=`candidate:${task.generation}`;
        const cached=await workerState(task_id,execution,key,'Candidate synthesis');
        const result=candidateProposalSchema.parse(cached??await ctx.agent('campaign_builder',{message:JSON.stringify({...(await campaignContext(task_id,execution)),reportingInstructions:humanCommunicationInstructions}),outputSchema:z.toJSONSchema(candidateProposalSchema.required({humanSummary:true})) as NonNullable<AgentInput['outputSchema']>}));
        await workerState(task_id,execution,key,'Candidate synthesis',result);
        return advance(task_id,execution,'done',{},'completed',null,result);
      }
      if(task.context?.mode === "auto" && !task.checkpoint.route) {
        const schema=z.object({kind:z.enum(["research","experiment","campaign"]),reason:z.string().min(1).max(1500),limitation:z.string().max(2000),confirmationPairs:z.number().int().min(2).max(512).optional()});
        const key=`route:${task.generation}`;
        const cached=await workerState(task_id,execution,key,"Planning");
        const plan=schema.parse(cached??await ctx.agent("task_router",{message:JSON.stringify({objective:task.objective,completionTarget:task.acceptance_criteria,budgetUsd:task.max_cost_usd}),outputSchema:z.toJSONSchema(schema) as NonNullable<AgentInput["outputSchema"]>}));
        await workerState(task_id,execution,key,"Planning",plan);
        if(plan.kind==='campaign')return adoptCampaign(task_id,execution,plan.confirmationPairs??64);
        if(plan.limitation)return advance(task_id,execution,task.phase,{},"needs_input",plan.limitation,{summary:plan.limitation,evidence:[]});
        task=await routeTask(task_id,execution,plan.kind,plan.reason);
        if(task.status!=="running")return task;
      }
      if (task.kind === "research") {
        const schema=z.object({status:z.enum(["completed","needs_input"]),humanSummary:humanSummarySchema.optional(),summary:z.string().min(1).max(8000),evidence:z.array(z.string().max(1500)).max(40),unknowns:z.array(z.string().max(2000)).max(20)});
        const key=`research:${task.generation}`;
        const cached=await workerState(task_id,execution,key,"Researcher");
        const shared=task.context?.campaignId?await campaignContext(task_id,execution):undefined;
        const result=schema.parse(cached ?? await ctx.agent("background_research",{message:JSON.stringify({reportingInstructions:humanCommunicationInstructions,objective:task.objective,acceptanceCriteria:task.acceptance_criteria,context:task.context,checkpoint:task.checkpoint,shared}),outputSchema:z.toJSONSchema(schema.required({humanSummary:true})) as NonNullable<AgentInput["outputSchema"]>}));
        await workerState(task_id,execution,key,"Researcher",result);
        return advance(task_id,execution,result.status === "completed" ? "done" : task.phase,{},result.status,result.status === "needs_input" ? result.summary : null,result);
      }
      if (task.phase === "propose") {
        const context = await taskContext(task_id, execution);
        const proposals = await Promise.all([0, 1].map(async index => {
          const key = `proposal:${index}`;
          const cached = await workerState(task_id, execution, key, `Proposal ${index + 1}`);
          if (cached) return semanticChangeSchema.parse(cached);
          try {
            const output = await ctx.agent("task_proposer", {
              message: JSON.stringify({ instruction: index === 0 ? "Identify the most direct minimal change meeting the objective." : "Independently consider an alternative approach, emphasizing robustness and avoiding regressions.", ...context }),
              outputSchema: z.toJSONSchema(semanticChangeSchema) as NonNullable<AgentInput["outputSchema"]>,
            });
            const proposal = semanticChangeSchema.parse(output);
            await workerState(task_id, execution, key, `Proposal ${index + 1}`, proposal);
            return proposal;
          } catch (error) {
            await workerState(task_id, execution, key, `Proposal ${index + 1}`, { error: taskErrorMessage(error) }, true);
            throw error;
          }
        }));
        task = await advance(task_id, execution, "select", { proposals });
      }
      if (task.phase === "select") {
        const key = `review:${task.generation}`;
        const cached = await workerState(task_id, execution, key, "Proposal review");
        const decision = selectionSchema.parse(cached ?? await ctx.agent("task_reviewer", {
          message: JSON.stringify({ mode: "select", ...(await taskContext(task_id, execution)), proposals: task.checkpoint.proposals }),
          outputSchema: z.toJSONSchema(selectionSchema) as NonNullable<AgentInput["outputSchema"]>,
        }));
        await workerState(task_id, execution, key, "Proposal review", decision);
        if (decision.selected === -1) return advance(task_id, execution, task.cycle_id ? "done" : "select", {}, task.cycle_id ? "completed" : "needs_input", decision.reason, { satisfied: false, summary: decision.reason, evidence: [], needsInput: "" });
        const proposals = z.array(semanticChangeSchema).length(2).parse(task.checkpoint.proposals);
        task = await advance(task_id, execution, "save", { proposal: proposals[decision.selected], selection: decision });
      }
      if (task.phase === "save") task = await saveProposal(task_id, execution);
      if (task.phase === "upload") task = await uploadTaskPolicy(task_id, execution);
      if (task.phase === "request_game") return requestTaskGame(task_id, execution);
      if (task.phase === "evaluate") {
        const context = await evaluationContext(task_id, execution);
        if (!context) return advance(task_id, execution, "evaluate", {}, "waiting", "Waiting for complete hosted statistics");
        const key = `evaluation:${task.generation}`;
        const cached = await workerState(task_id, execution, key, "Evidence review");
        const result = evaluationSchema.parse(cached ?? await ctx.agent("task_reviewer", {
          message: JSON.stringify({ mode: "evaluate", ...context, reportingInstructions: humanCommunicationInstructions }), outputSchema: z.toJSONSchema(evaluationSchema.required({humanSummary:true})) as NonNullable<AgentInput["outputSchema"]>,
        }));
        await workerState(task_id, execution, key, "Evidence review", result);
        if (task.cycle_id) return advance(task_id, execution, "done", {}, "completed", result.satisfied ? null : "Investigation concluded with inconclusive findings", result);
        return advance(task_id, execution, result.satisfied ? "done" : "evaluate", {}, result.satisfied ? "completed" : "needs_input",
          result.satisfied ? null : result.needsInput || "The available evidence does not establish the acceptance criteria.", result);
      }
      return { status: task.status };
    } catch (error) {
      await taskFailure(task_id, execution, taskErrorMessage(error));
      throw error;
    }
  },
});
