import { readableText } from "./communication.ts";

type IssueTask = {id:string;status:string;reason:string|null;updated_at:string;checkpoint:Record<string,unknown>;context?:{policyId?:string;episodeId?:string}|null};
export function humanIssues(tasks:IssueTask[]) {
  const groups = new Map<string,{key:string;kind:"question"|"billing"|"service";text:string;taskIds:string[]}>();
  for (const task of [...tasks].sort((a,b)=>b.updated_at.localeCompare(a.updated_at))) {
    if (task.status!=="needs_input" || !task.reason || task.checkpoint.daily_budget_day) continue;
    const raw = task.reason;
    const plain = readableText(raw).replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/https?:\/\/\S+/g,"").replace(/\s+/g," ").trim();
    const billing = /no credits|insufficient (?:credits|quota|funds)|credits? (?:exhausted|remaining|balance)|billing|credit balance|quota exceeded/i.test(raw);
    const service = /rate.?limit|service unavailable|connection (?:failed|timeout)|timed out|api key|authentication|unauthorized/i.test(raw);
    const kind = billing ? "billing" : service ? "service" : "question";
    const provider = /openai/i.test(raw)?"openai":/anthropic/i.test(raw)?"anthropic":"provider";
    const key = kind==="question" ? JSON.stringify([plain.toLowerCase().replace(/[.!?]+$/,""),task.context?.policyId,task.context?.episodeId]) : `${kind}:${provider}`;
    const group = groups.get(key);
    if (group) group.taskIds.push(task.id);
    else groups.set(key,{key,kind,text:billing?"Preston is paused because API credits are exhausted.":service?"Preston is paused by a service connection issue.":plain,taskIds:[task.id]});
  }
  return [...groups.values()];
}
