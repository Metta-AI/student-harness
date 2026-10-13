import {z} from 'zod';
export const studyFollowUpReceipt=z.discriminatedUnion('status',[
 z.object({status:z.literal('proposed'),studyId:z.uuid(),planId:z.uuid(),reason:z.string().max(1000)}),
 z.object({status:z.literal('not_proposed'),reason:z.string().max(1000)}),
]);
