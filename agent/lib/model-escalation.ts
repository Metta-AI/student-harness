import {defineState} from 'eve/context';

/** Auto model escalation. A conversation on Auto starts on the first ladder
 * rung and steps up while it is struggling: failed tool calls count one,
 * malformed tool calls (rejected before any action runs) count one,
 * a completion review that finds the work unfinished counts two. A finished
 * review clears the count; each new turn halves it, so a recovered
 * conversation drifts back down to the cheap model. */
export type ModelEscalation={struggle:number;turnId:string;actionStep?:number};
export const modelEscalationState=defineState<ModelEscalation>('preston.model-escalation',()=>({struggle:0,turnId:''}));
export const escalationThresholds=[3,6] as const;
export function escalationLevel(struggle=modelEscalationState.get().struggle){
 return escalationThresholds.filter(threshold=>struggle>=threshold).length;
}
