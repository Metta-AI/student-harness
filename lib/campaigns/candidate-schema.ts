import {z} from 'zod';
export const componentSchema=z.object({id:z.string().min(1).max(80),before:z.string().min(1),after:z.string(),condition:z.string().min(1),action:z.string().min(1),expected:z.string().min(1),falsifier:z.string().min(1),evidence:z.array(z.string()).min(1)});
export type Component=z.infer<typeof componentSchema>;
export const candidateProposalSchema=z.object({summary:z.string().min(1),components:z.array(componentSchema).min(1).max(8)});
