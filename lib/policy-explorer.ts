import {createHash} from 'node:crypto';
import {policySourceModelSchema, type PolicySourceModel} from './policy-source-model';
import {semanticIrSchema} from './semantic-ir';
import type {PolicyExplanation} from './workspace/policy-explorer';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const humanName=(name:string)=>name.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');

/** Structural evidence only. Comments are author descriptions, not verified runtime behavior. */
export function explainPolicy(source:string,metadata:{policyId:string;origin:'saved'|'hosted';revision?:number;summary?:string;ir?:unknown;model?:PolicySourceModel}):PolicyExplanation {
 if(!source.trim()||Buffer.byteLength(source)>65536)throw Error('Policy source must be a nonempty BASIC file under 64 KiB.');
 const lines=source.split('\n'),offsets:number[]=[];let offset=0;
 for(const line of lines){offsets.push(offset);offset+=line.length+1;}
 const lineAt=(pos:number)=>{let i=0;while(i+1<offsets.length&&offsets[i+1]<=pos)i++;return i+1;};
 const ranges:{name:string;kind:'routine'|'program';start:number;end:number}[]=[];
 let cursor=0;
 const routines=[...source.matchAll(/^[ \t]*(?:sub|function)\s+([a-zA-Z_][a-zA-Z_0-9]*)[^\n]*\n[\s\S]*?^[ \t]*end\s+(?:sub|function)\b[^\n]*(?:\n|$)/gim)];
 for(const routine of routines){
  if(source.slice(cursor,routine.index).trim())ranges.push({name:cursor===0?'Declarations & setup':'Main program',kind:'program',start:cursor,end:routine.index});
  ranges.push({name:routine[1],kind:'routine',start:routine.index,end:routine.index+routine[0].length});cursor=routine.index+routine[0].length;
 }
 if(source.slice(cursor).trim())ranges.push({name:'Main program',kind:'program',start:cursor,end:source.length});
 const routineNames=routines.map(r=>r[1]);
 const parsed=semanticIrSchema.safeParse(metadata.ir);
 const ir=parsed.success&&parsed.data.execution.source_sha256===hash(source)?parsed.data:null;
 const candidate=policySourceModelSchema.safeParse(metadata.model??ir?.source_model);
 const model=candidate.success&&candidate.data.sourceHash===hash(source)?candidate.data:null;
 const validRules=ir?.strategy.filter(r=>r.source.status==='mapped'&&r.source.start>=0&&r.source.end<=source.length&&r.source.end>r.source.start&&hash(source.slice(r.source.start,r.source.end))===r.source.sha256&&r.when in ir.situation.predicates&&r.skill in ir.skill&&r.for.every(g=>g in ir.goal))??[];
 const semanticRules=validRules.filter(r=>ir!.skill[r.skill]?.operator!=='opaque_import');
 const covered=new Set<number>();
 const facts=(start:number,end:number)=>{
  const fragment=source.slice(start,end),first=lineAt(start);
  return {guards:fragment.split('\n').flatMap((text,i)=>/^\s*(?:if|elseif|while|case)\b/i.test(text)?[{line:first+i,text:text.trim()}]:[]),calls:routineNames.filter(name=>new RegExp(`\\b${name}\\s*\\(`,'i').test(fragment.replace(/^[ \t]*(?:sub|function)[^\n]*/im,'')))};
 };
 const outline=ranges.map((r,i)=>{
  const fragment=source.slice(r.start,r.end),comment=fragment.split('\n').slice(0,5).find(l=>/^\s*'/.test(l))?.trim().replace(/^'\s*/,'');
  return {id:`source-${i}`,name:r.kind==='routine'?humanName(r.name):r.name,kind:r.kind,summary:comment??(r.kind==='routine'?`Routine ${r.name}`:'Top-level BASIC statements'),goals:[],start:r.start,end:r.end,line:lineAt(r.start),lastLine:lineAt(r.end-1),...facts(r.start,r.end),basis:'source' as const};
 });
 const structural=model?model.routines.map(r=>({id:r.id,name:humanName(r.name),kind:'routine' as const,summary:r.description,condition:r.conditions[0]?.text,action:r.assignments.length?`${r.assignments.length} assignments. First: ${r.assignments[0].text}`:undefined,goals:[],start:r.start,end:r.end,line:r.line,lastLine:r.lastLine,guards:r.conditions,calls:r.calls,basis:'source' as const})):outline;
 const authored=semanticRules.map(r=>{
  for(let n=lineAt(r.source.start);n<=lineAt(r.source.end-1);n++)covered.add(n);
  return {id:r.id,name:r.intent,kind:'semantic' as const,summary:r.intent,condition:ir!.situation.predicates[r.when],action:ir!.skill[r.skill]?.intent,goals:r.for.flatMap(g=>ir!.goal[g]?[ir!.goal[g].claim]:[]),start:r.source.start,end:r.source.end,line:lineAt(r.source.start),lastLine:lineAt(r.source.end-1),...facts(r.source.start,r.source.end),basis:'authored' as const};
 });
 const comments=[] as string[];
 for(const line of lines){if(!line.trim())continue;if(!/^\s*'/.test(line))break;comments.push(line.trim().replace(/^'\s*/,''));if(comments.length===5)break;}
 return {policyId:metadata.policyId,source,hash:hash(source),origin:metadata.origin,revision:metadata.revision??null,summary:metadata.summary||model?.description||comments[0]||'Read the source outline and decision guards below.',comments,sections:[...authored,...structural],beliefs:ir?Object.values(ir.belief.claims):[],unknowns:[...model?.limitations??[],...ir?.situation.unknowns??[],...metadata.ir&&!ir?['The saved semantic map does not match these source bytes; its claims are omitted.']:[], 'Source conditions and comments describe code; replay evidence is needed to verify behavior.'],coverage:{mappedLines:covered.size,totalLines:lines.length,staleRules:ir?ir.strategy.length-validRules.length:0},representation:{status:model?'ready':'available',routines:model?.routines.length??0,conditions:model?.routines.reduce((n,r)=>n+r.conditions.length,0)??0,assignments:model?.routines.reduce((n,r)=>n+r.assignments.length,0)??0},checkedAt:new Date().toISOString()};
}
