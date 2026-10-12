import {z} from 'zod';
import {tufteChartSchema} from '../charts/tufte';
import {viewSchema} from './presentation';

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const label=z.string().min(1).max(160);
export const appActionTargetSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('section'),sectionId:id}).strict(),
  z.object({kind:z.literal('tab'),tabId:z.string().min(1).max(2000)}).strict(),
  z.object({kind:z.literal('view'),view:viewSchema}).strict(),
]);
export type AppActionTarget=z.infer<typeof appActionTargetSchema>;
/** Declarative controls only: generated apps cannot execute scripts or arbitrary requests. */
export const appBlockSchema=z.discriminatedUnion('kind',[
  z.object({id,kind:z.literal('episodes')}),
  z.object({id,kind:z.literal('view'),view:viewSchema}),
  z.object({id,kind:z.literal('chart'),title:label,chart:tufteChartSchema}),
  z.object({id,kind:z.literal('text'),body:z.string().min(1).max(12000)}),
  z.object({id,kind:z.literal('input'),label,placeholder:z.string().max(500).optional(),multiline:z.boolean().optional()}),
  z.object({id,kind:z.literal('choice'),label,options:z.array(label).min(2).max(12)}),
  z.object({id,kind:z.literal('check'),label}),
  z.object({id,kind:z.literal('action'),label,target:appActionTargetSchema.optional(),prompt:z.string().min(1).max(6000).optional().describe('Read-only legacy compatibility. Never author prompt actions.'),fields:z.array(id).max(20).default([])}).refine(a=>!!a.target||!!a.prompt,'Actions require an app destination'),
]);
export const microAppSchema=z.object({
  purpose:z.string().min(1).max(500),
  steps:z.array(label).min(1).max(5),
  sections:z.array(z.object({id,title:label,description:z.string().max(500).optional(),blocks:z.array(appBlockSchema).min(1).max(16)})).min(1).max(12),
}).superRefine((app,ctx)=>{
  const sections=app.sections.map(s=>s.id),blocks=app.sections.flatMap(s=>s.blocks);
  if(new Set(sections).size!==sections.length||new Set(blocks.map(b=>b.id)).size!==blocks.length)ctx.addIssue({code:'custom',message:'Section and control IDs must be unique within an app'});
  if(blocks.filter(b=>b.kind==='episodes').length>1)ctx.addIssue({code:'custom',message:'Use one live episode library per app'});
  for(const block of blocks)if(block.kind==='action'&&block.target?.kind==='section'&&!sections.includes(block.target.sectionId))ctx.addIssue({code:'custom',message:'Section actions must point to an existing app section'});
  const inputs=new Set(blocks.filter(b=>['input','choice','check'].includes(b.kind)).map(b=>b.id));
  if(blocks.some(b=>b.kind==='action'&&b.fields.some(field=>!inputs.has(field))))ctx.addIssue({code:'custom',message:'Actions may only reference inputs in this app'});
});
export type MicroApp=z.infer<typeof microAppSchema>;
export type AppBlock=z.infer<typeof appBlockSchema>;
export const appValuesSchema=z.record(z.string().max(2000),z.record(id,z.union([z.string().max(4000),z.boolean()])));
export type AppValues=z.infer<typeof appValuesSchema>;

/** Saved prompt-only actions remain readable but are never executable. */
export function appActionTarget(action:Extract<AppBlock,{kind:'action'}>):AppActionTarget|null {
  return action.target??null;
}
