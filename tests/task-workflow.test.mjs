import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { registerHooks } from "node:module";

// Match the application's bundler resolution while exercising the authored workflow directly.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
} });
let state;
const operations = {
  routeTask:async(_id,_execution,kind,reason)=>{Object.assign(state.task,{kind,reason,checkpoint:{route:{kind,reason}}});return structuredClone(state.task);},
  beginTask: async () => state.claimed ? null : (state.claimed = true, structuredClone(state.task)),
  taskContext: async () => ({ source: "original source", objective: "Improve behavior" }),
  workerState: async (_id, _execution, key, _role, output) => {
    if (output !== undefined) state.workers.set(key, output);
    return state.workers.get(key) ?? null;
  },
  advance: async (_id, _execution, phase, patch = {}, status = "running", reason = null, result = null) => {
    if (state.paused) throw new Error("Task execution is no longer active");
    Object.assign(state.task, { phase, status, reason, result, checkpoint: { ...state.task.checkpoint, ...patch } });
    state.events.push(phase);
    return structuredClone(state.task);
  },
  saveProposal: async () => { state.events.push("saved"); state.task.phase = "upload"; return structuredClone(state.task); },
  uploadTaskPolicy: async () => { state.events.push("uploaded"); state.task.phase = "request_game"; return structuredClone(state.task); },
  requestTaskGame: async () => { state.events.push("game_requested"); state.task.phase = "evaluate"; state.task.status = "waiting"; return structuredClone(state.task); },
  evaluationContext: async () => state.evidence,
  taskFailure: async (_id, _execution, error) => { state.failure = error; },
};
mock.module("../agent/lib/tasks/steps.ts", { namedExports: operations });
const { default: workflow } = await import("../agent/tools/run_task.ts");
const proposal = { before: "original source", after: "improved source", summary: "A focused gameplay change", semantic: Object.fromEntries(["condition", "action", "goal", "hypothesis", "expected", "non_trigger"].map(key => [key, `${key} with testable detail`])) };
const evaluation = { satisfied: true, summary: "Recorded measured outcome with uncertainty", evidence: ["experiment:xp-1"], needsInput: "" };
function reset(phase = "propose") {
  state = { task: { id: "task-1", execution_key: "exec-1", phase, status: "running", generation: 0, checkpoint: {} }, workers: new Map(), events: [], claimed: false, evidence: { experiment: "xp-1" }, failure: null, paused: false };
}
const run = agent => workflow.execute({ task_id: "task-1" }, { agent });
test('workflow preserves serialized child-agent rate-limit diagnostics',async()=>{
 reset();state.task.kind='research';
 const error={message:'Failed after 3 attempts: Rate limit reached for gpt-6-astra',request:{secret:'never expose'}};
 await assert.rejects(run(async()=>{throw error;}));
 assert.equal(state.failure,error.message);
});
test("workflow launches proposals concurrently, then saves and requests exactly one game", async () => {
  reset(); let started = 0; let release;
  const bothStarted = new Promise(resolve => { release = resolve; });
  const output = await run(async (name) => {
    if (name === "task_proposer") { started++; if (started === 2) release(); await bothStarted; return proposal; }
    assert.equal(started, 2); return { selected: 0, reason: "Directly addresses the objective" };
  });
  assert.equal(started, 2);
  assert.deepEqual(state.events, ["select", "save", "saved", "uploaded", "game_requested"]);
  assert.equal(output.status, "waiting");
  assert.equal(output.phase, "evaluate");
});
test("workflow resumes from hosted results without repeating proposals, saves, or game requests", async () => {
  reset("evaluate");
  let calls = 0;
  const output = await run(async (name, input) => { assert.equal(name, "task_reviewer"); assert.equal(JSON.parse(input.message).mode, "evaluate"); calls++; return evaluation; });
  assert.equal(calls, 1); assert.equal(output.status, "completed");
  assert.deepEqual(state.events, ["done"]);
});
test("workflow parks when evidence is unavailable and asks for input when inconclusive", async () => {
  reset("evaluate"); state.evidence = null;
  const waiting = await run(async () => { throw new Error("should not invoke a model"); });
  assert.equal(waiting.status, "waiting");
  reset("evaluate");
  const inconclusive = await run(async () => ({ ...evaluation, satisfied: false, needsInput: "Describe the retreat seen in this replay." }));
  assert.equal(inconclusive.status, "needs_input"); assert.equal(inconclusive.phase, "evaluate");
});
test("workflow reuses saved proposal output after interruption", async () => {
  reset(); state.workers.set("proposal:0", proposal);
  let proposals = 0;
  await run(async name => name === "task_proposer" ? (proposals++, proposal) : { selected: 1, reason: "Alternative is better supported" });
  assert.equal(proposals, 1);
});
test("workflow rejects both proposals without mutating policy or requesting a game", async () => {
  reset();
  const output = await run(async name => name === "task_proposer" ? proposal : { selected: -1, reason: "Need a concrete replay observation" });
  assert.equal(output.status, "needs_input");
  assert.deepEqual(state.events, ["select", "select"]);
});
test("workflow cannot promote work after a pause and ignores duplicate claims", async () => {
  reset(); state.paused = true;
  await assert.rejects(run(async () => proposal), /no longer active/);
  assert.deepEqual(state.events, []);
  reset(); state.claimed = true;
  assert.deepEqual(await run(async () => { throw new Error("should not run"); }), { status: "already_claimed_or_stopped" });
});

test("research completes an inconclusive investigation without claiming improvement", async () => {
  reset("evaluate"); state.task.cycle_id = "cycle-1";
  const output = await run(async () => ({ ...evaluation, satisfied: false, needsInput: "More comparable evidence is needed." }));
  assert.equal(output.status, "completed");
  assert.equal(state.task.result.satisfied, false);
  assert.deepEqual(state.events, ["done"]);
});

test("baseline-only research skips proposal workers and policy saves", async () => {
  reset("upload"); state.task.cycle_id = "cycle-1";
  state.task.checkpoint = { research_mode: "baseline", version_id: "base-1" };
  const output = await run(async () => { throw new Error("Baseline must not propose a mutation"); });
  assert.equal(output.status, "waiting");
  assert.deepEqual(state.events, ["uploaded", "game_requested"]);
});

test('background research saves evidence and uncertainty without mutating a policy', async () => {
 reset();state.task.kind='research';state.task.context={mode:'replay',episodeId:'ereq_example'};
 const finding={status:'completed',summary:'Recorded scores do not establish the strategy.',evidence:['episode:ereq_example'],unknowns:['No visual behavior inspected.']};
 const output=await run(async(name,input)=>{assert.equal(name,'background_research');assert.equal(JSON.parse(input.message).context.episodeId,'ereq_example');return finding;});
 assert.equal(output.status,'completed');assert.deepEqual(state.events,['done']);assert.deepEqual(output.result,finding);
 reset();state.task.kind='research';state.workers.set('research:0',finding);
 const recovered=await run(async()=>{throw Error('Must reuse checkpointed research result');});
 assert.equal(recovered.status,'completed');
});

test('automatic planning selects research without requiring a work-type form field',async()=>{
 reset();state.task.kind='research';state.task.context={mode:'auto'};const calls=[];
 const result=await run(async name=>{calls.push(name);return name==='task_router'?{kind:'research',reason:'Inspect recorded league evidence.',limitation:''}:{status:'completed',summary:'Evidence checked.',evidence:[],unknowns:[]};});
 assert.deepEqual(calls,['task_router','background_research']);assert.equal(result.status,'completed');
});
test('automatic planning routes policy edits to the experiment pipeline',async()=>{
 reset();state.task.kind='research';state.task.context={mode:'auto'};
 const result=await run(async name=>name==='task_router'?{kind:'experiment',reason:'Test one reviewed change.',limitation:''}:name==='task_proposer'?proposal:{selected:0,reason:'Addresses the objective'});
 assert.equal(result.status,'waiting');assert(state.events.includes('game_requested'));
});
test('unsupported completion target is surfaced before edits or hosted games',async()=>{
 reset();state.task.kind='research';state.task.context={mode:'auto'};let calls=0;
 const result=await run(async name=>{calls++;assert.equal(name,'task_router');return {kind:'experiment',reason:'Compare policy variants.',limitation:'The current runner supports one game, not a 40-game evaluation.'};});
 assert.equal(calls,1);assert.equal(result.status,'needs_input');assert.match(result.reason,/40-game/);assert.deepEqual(state.events,['propose']);
});
