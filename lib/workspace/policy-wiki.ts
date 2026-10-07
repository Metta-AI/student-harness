import type { PolicyRevision } from "../semantic-ir";
export const wikiPages = ["overview", "ontology", "beliefs", "source", "versions", "evidence", "reference"] as const;
export type WikiPage = typeof wikiPages[number];
export const wikiPageLabels: Record<WikiPage,string> = {overview:"Overview",ontology:"Semantic ontology",beliefs:"Beliefs & lessons",source:"Symbolic source",versions:"Version history",evidence:"Evidence & verification",reference:"Game reference"};
export type WikiKind = "situation"|"belief"|"goal"|"skill"|"strategy"|"execution"|"update";
export type WikiEntry = {key:string;id:string;kind:WikiKind;summary:string;fields:unknown;links:{key:string;label:string}[];ruleId?:string};
/** Project the stored ontology without guessing belief-to-strategy or causal edges. */
export function policyWikiEntries(revision:PolicyRevision):WikiEntry[]{
 const {ir}=revision;const entries:WikiEntry[]=[];
 const add=(kind:WikiKind,id:string,summary:string,fields:unknown,links:WikiEntry['links']=[],ruleId?:string)=>entries.push({key:`${kind}:${id}`,kind,id,summary,fields,links,ruleId});
 for(const [id,condition] of Object.entries(ir.situation.predicates))add('situation',id,condition,{condition,authority:ir.situation.authority,unknowns:ir.situation.unknowns});
 for(const [id,belief] of Object.entries(ir.belief.claims))add('belief',id,belief.claim,belief);
 for(const [id,goal] of Object.entries(ir.goal))add('goal',id,goal.claim,goal);
 for(const [id,skill] of Object.entries(ir.skill))add('skill',id,skill.intent,skill);
 for(const rule of ir.strategy)add('strategy',rule.id,rule.intent,rule,[{key:`situation:${rule.when}`,label:rule.when},{key:`skill:${rule.skill}`,label:rule.skill},...rule.for.map(id=>({key:`goal:${id}`,label:id}))],rule.id);
 add('execution',ir.execution.binding,ir.execution.language,ir.execution);
 add('update',`r${ir.update.revision}`,ir.update.change,ir.update);
 return entries;
}
export function searchWikiEntries(entries:WikiEntry[],query:string){const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);return entries.filter(e=>words.every(w=>`${e.kind} ${e.id} ${e.summary} ${JSON.stringify(e.fields)}`.toLowerCase().includes(w)));}
