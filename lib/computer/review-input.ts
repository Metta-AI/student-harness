import {z} from 'zod';
import {desktopCommand} from './model';
const commands=desktopCommand.options;
export const reviewedCommand=z.discriminatedUnion('action',[
 commands[1].omit({id:true}),commands[2].omit({id:true}),commands[3].omit({id:true}),commands[4].omit({id:true}),commands[5].omit({id:true}),
]);
export const computerActionInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('propose'),computerId:z.uuid(),intent:z.string().trim().min(8).max(500),command:reviewedCommand}).strict(),
 z.object({action:z.literal('status'),reviewId:z.uuid()}).strict(),
]);
export const computerReviewMutation=z.discriminatedUnion('action',[
 z.object({action:z.literal('list'),computerId:z.uuid()}).strict(),
 z.object({action:z.enum(['approve','reject','status']),reviewId:z.uuid()}).strict(),
]);
export const computerActionDescription='Propose exactly one input on the isolated Linux desktop for owner review, or read its saved status. First inspect_computer to obtain a fresh screenshot and epoch/view. Propose never executes input; give the purpose and exact click, type, key, scroll or drag. Direct the human to the returned review URL, then return to conversation. Only the human review UI can approve. Review expires after 30 seconds and the worker requires a screenshot under 30 seconds old. Stale views require fresh observation and a newly reviewed proposal. Never repeat an unknown input: inspect this review and operation receipt. Do not ask for passwords or put credentials in typed text. Approval covers only the displayed operation, never future actions, paid games, league submission or unrelated work. Respect takeover, Stop, holds and voice closure.';
export type ReviewedCommand=z.infer<typeof reviewedCommand>;
export type ComputerReview={id:string;computerId:string;intent:string;command:ReviewedCommand;status:string;expiresAt:string;operationId:string;url:string;result:unknown};
