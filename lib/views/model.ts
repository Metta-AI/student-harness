import { z } from 'zod';
const link=z.string().max(1000).refine(value=>{try{const u=new URL(value,'http://workspace.local');return value.startsWith('/?')||(u.protocol==='https:'&&!u.username&&!u.password);}catch{return false;}},'Use an HTTPS evidence URL or a workspace link');
const evidence=z.array(z.object({label:z.string().min(1).max(160),href:link})).max(12).default([]);
const text=z.string().min(1).max(3000);
export const viewDocumentSchema=z.object({
  title:z.string().min(1).max(120),summary:z.string().max(1000).default(''),
  blocks:z.array(z.discriminatedUnion('type',[
    z.object({type:z.literal('text'),title:z.string().max(160),text,evidence}),
    z.object({type:z.literal('table'),title:z.string().max(160),columns:z.array(z.string().max(100)).min(1).max(8),rows:z.array(z.array(z.string().max(500)).max(8)).max(60),evidence}).refine(b=>b.rows.every(r=>r.length===b.columns.length),'Each row must match its columns'),
    z.object({type:z.literal('bar_chart'),title:z.string().max(160),unit:z.string().max(60),points:z.array(z.object({label:z.string().max(100),value:z.number().finite()})).min(1).max(30),evidence}),
    z.object({type:z.literal('steps'),title:z.string().max(160),items:z.array(z.object({label:z.string().max(160),detail:text})).min(1).max(12),evidence}),
  ])).min(1).max(12),
}).strict();
export type ViewDocument=z.infer<typeof viewDocumentSchema>;
export const createViewSchema=viewDocumentSchema.extend({requestToken:z.string().min(1).max(100)});
