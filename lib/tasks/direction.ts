import {z} from 'zod';
export const directionReviewSchema=z.object({
 action:z.enum(['continue','replan','pause']),
 reason:z.string().min(8).max(2000),
});
export function proposalWorkerKey(index:number,revision=0){
 // Existing completed proposals remain reusable for unchanged tasks and retries.
 return revision===0?`proposal:${index}`:`proposal:${index}:direction:${revision}`;
}
