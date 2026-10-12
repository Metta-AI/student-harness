import {z} from 'zod';

/** Trusted server authorization, never part of a model/browser input schema.
 * SQL binds it to one immutable operation and the current hold generation. */
export type ReviewedContainerRequest={sessionId:string;reviewed:true};
const reviewedSchema=z.strictObject({sessionId:z.string().trim().min(1).max(200),reviewed:z.literal(true)});
export function reviewedContainerArgs(value:ReviewedContainerRequest|undefined){
 return value===undefined?{}:{p_session:reviewedSchema.parse(value).sessionId};
}
