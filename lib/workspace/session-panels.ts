import {z} from 'zod';
import {manifestHashSchema,gameDocumentIdSchema} from '../game-contract-model';
import type {Task} from '../tasks/model';
import {resultPreview} from '../tasks/communication';
import {viewSchema,type WorkspaceView} from './presentation';
import {microAppSchema} from './micro-app';

const identity={id:z.string().min(1).max(2000),title:z.string().min(1).max(120)};
export const sessionPanelSchema=z.discriminatedUnion('kind',[
  z.object({...identity,kind:z.literal('terminal'),panel:z.enum(['terminal','files','changes'])}),
  z.object({...identity,kind:z.literal('app'),app:microAppSchema,templateId:z.string().max(80).optional()}),
  z.object({...identity,kind:z.literal('policy')}),
  z.object({...identity,kind:z.literal('game-guide'),manifestHash:manifestHashSchema.optional(),documentId:gameDocumentIdSchema.optional()}),
  z.object({...identity,kind:z.literal('view'),view:viewSchema}),
  z.object({...identity,kind:z.literal('replay'),episodeId:z.string().regex(/^ereq_[0-9a-f-]{36}$/),policyVersionId:z.uuid().optional(),runId:z.string().regex(/^xreq_[0-9a-f-]{36}$/).optional()}),
  z.object({...identity,kind:z.literal('research'),taskId:z.uuid()}),
]);
export type SessionPanel=z.infer<typeof sessionPanelSchema>;
export const sessionWorkspaceSchema=z.object({
  requestToken:z.string().min(1).max(100),title:z.string().min(1).max(120).optional(),
  tabs:z.array(sessionPanelSchema).min(1).max(12),activeTabId:z.string().min(1).max(2000).optional(),
}).refine(w=>new Set(w.tabs.map(t=>t.id)).size===w.tabs.length,'Tab IDs must be unique')
  .refine(w=>!w.activeTabId||w.tabs.some(t=>t.id===w.activeTabId),'The selected tab must exist');
export function viewPanel(view:WorkspaceView):SessionPanel {
  const {reason,...identity}=view;
  return {id:view.artifactId??JSON.stringify(identity),kind:'view',title:reason.slice(0,120),view};
}
/** Update named tabs in place; new evidence never discards earlier artifacts. */
export function mergeSessionPanels(current:SessionPanel[],incoming:SessionPanel[]):SessionPanel[]{
  const next=[...current];
  for(const panel of incoming){
    const index=next.findIndex(p=>p.id===panel.id||
      p.kind==='policy'&&panel.kind==='policy'||
      p.kind==='view'&&panel.kind==='view'&&viewPanel(p.view).id===viewPanel(panel.view).id||
      p.kind==='research'&&panel.kind==='research'&&p.taskId===panel.taskId||
      p.kind==='replay'&&panel.kind==='replay'&&p.episodeId===panel.episodeId);
    if(index<0)next.push(panel);else next[index]=panel;
  }
  return next;
}

export const policyContextPanel:SessionPanel={id:'policy-context',title:'Policy',kind:'policy'};
export function initialSessionPanels(tabs:SessionPanel[]|undefined,view:WorkspaceView|undefined){
  const saved=tabs??(view?[viewPanel(view)]:[]);
  return saved.some(panel=>panel.kind==='app'||panel.kind==='terminal')?mergeSessionPanels(saved,[policyContextPanel]):mergeSessionPanels([policyContextPanel],saved);
}

/** A task reference is not a result. Keep unfinished jobs out of the human canvas. */
export function researchResultReady(task:Pick<Task,'status'|'result'>|undefined){
  return task?.status==='completed'&&!!resultPreview(task.result).trim();
}
export function visibleSessionPanels(panels:SessionPanel[],tasks:Task[]){
  return panels.filter(panel=>panel.kind!=='research'||researchResultReady(tasks.find(task=>task.id===panel.taskId)));
}
