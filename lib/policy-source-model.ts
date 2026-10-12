import {createHash} from 'node:crypto';
import {z} from 'zod';

const statement=z.object({line:z.number().int().positive(),text:z.string()});
export const policySourceModelSchema=z.object({
 schema:z.literal('gota-source-semantics/1'),sourceHash:z.string().length(64),
 description:z.string(),limitations:z.array(z.string()),
 routines:z.array(z.object({id:z.string(),name:z.string(),description:z.string(),start:z.number(),end:z.number(),line:z.number(),lastLine:z.number(),
  conditions:z.array(statement),assignments:z.array(statement),calls:z.array(z.string()),comments:z.array(z.string())})),
});
export type PolicySourceModel=z.infer<typeof policySourceModelSchema>;
export const sourceDigest=(source:string)=>createHash('sha256').update(source).digest('hex');

// Mask quoted strings and comments before recognizing syntax. Keep offsets unchanged.
function syntax(line:string){
 let quote=false,result='';
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(c==='"'){if(quote&&line[i+1]==='"'){result+='  ';i++;continue;}quote=!quote;result+=' ';}
  else if(c==="'"&&!quote)break;
  else result+=quote?' ':c;
 }
 return /^\s*rem\b/i.test(result)?'':result;
}
/** A deterministic partial semantic representation. Literal conditions/actions are evidence;
 * author comments are descriptions, never inferred goals or verified runtime behavior. */
export function describePolicySource(source:string):PolicySourceModel {
 if(!source.trim()||Buffer.byteLength(source)>65536)throw Error('Policy source must be nonempty and at most 64 KiB.');
 const lines=source.split('\n'),offsets:number[]=[];let offset=0;
 for(const line of lines){offsets.push(offset);offset+=line.length+1;}
 const ranges:{name:string;first:number;last:number}[]=[];let cursor=0;
 for(let i=0;i<lines.length;i++){
  const match=syntax(lines[i]).match(/^\s*(sub|function)\s+([a-z_]\w*)/i);if(!match)continue;
  if(lines.slice(cursor,i).some(l=>l.trim()))ranges.push({name:cursor===0?'Declarations & setup':'Main program',first:cursor,last:i-1});
  let end=i;while(end+1<lines.length&&!new RegExp(`^\\s*end\\s+${match[1]}\\b`,'i').test(syntax(lines[end])))end++;
  ranges.push({name:match[2],first:i,last:end});cursor=end+1;i=end;
 }
 if(lines.slice(cursor).some(l=>l.trim()))ranges.push({name:'Main program',first:cursor,last:lines.length-1});
 const routines=ranges.map(r=>{
  const fragment=lines.slice(r.first,r.last+1),comments=fragment.flatMap(l=>{const m=l.match(/^\s*(?:'|rem\s)(.*)$/i);return m?.[1].trim()?[m[1].trim()]:[];});
  const conditions:PolicySourceModel['routines'][number]['conditions']=[],assignments:PolicySourceModel['routines'][number]['assignments']=[],calls=new Set<string>();
  fragment.forEach((line,index)=>{
   const clean=syntax(line),n=r.first+index+1;
   if(/^\s*(if|elseif|else|while|for|case|select|do|loop)\b/i.test(clean))conditions.push({line:n,text:line.trim()});
   if(/^\s*(?:let\s+)?[a-z_]\w*(?:\([^)]*\))?\s*=/i.test(clean))assignments.push({line:n,text:line.trim()});
   if(!/^\s*(sub|function|dim)\b/i.test(clean))for(const call of clean.matchAll(/\b([a-z_]\w*)\s*\(/ig))calls.add(call[1]);
  });
  return {id:`source-${r.first}`,name:r.name,description:comments[0]??r.name.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' '),start:offsets[r.first],end:Math.min(source.length,(offsets[r.last+1]??source.length)),line:r.first+1,lastLine:r.last+1,conditions,assignments,calls:[...calls],comments};
 });
 const header=[] as string[];
 for(const line of lines){if(!line.trim())continue;const m=line.match(/^\s*(?:'|rem\s)(.*)$/i);if(!m)break;if(m[1].trim())header.push(m[1].trim());}
 return {schema:'gota-source-semantics/1',sourceHash:sourceDigest(source),description:header[0]??`${routines.length} source sections; inspect their conditions, assignments and calls.`,routines,
  limitations:['Partial source analysis, not a BASIC interpreter. Conditions are listed in source order; reachability and runtime effects are not proven.','Call syntax can include array reads. Author comments are unverified descriptions. Goals and performance require authored intent or replay evidence.']};
}
