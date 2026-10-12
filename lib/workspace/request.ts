import {defaultLeagueId} from '../league-catalog';
import {z} from 'zod';
import {viewSchema} from './presentation';
import {sessionPanelSchema} from './session-panels';
import {appValuesSchema} from './micro-app';
import {replayMomentSchema} from './replay-analysis';

export const workspaceRequestSchema=z.object({
  id:z.string().min(1).max(128),shortId:z.string().regex(/^[A-Za-z0-9_-]{12}$/).optional(),prompt:z.string().min(1).max(50000),
  mode:z.enum(['auto','learn','do','view','research']),policyId:z.string(),
  sessionId:z.string().min(4).max(128).optional(),token:z.string(),
  terminalGrantId:z.uuid().optional(),
  template:z.object({id:z.string().max(80),version:z.number().int().positive()}).optional(),
  appValues:appValuesSchema.optional(),
  closedTabs:z.array(z.string().max(5000)).optional(),
  replayMoments:z.record(z.string(),z.array(replayMomentSchema).max(200)).optional(),
  view:viewSchema.optional(),tabs:z.array(sessionPanelSchema).optional(),appliedToolCallIds:z.array(z.string()).optional(),activeTabId:z.string().optional(),workspaceTitle:z.string().max(120).optional(),notes:z.record(z.string(),z.string().max(4000)).optional(),pinned:z.boolean().default(false),
});
export type WorkspaceRequest=z.infer<typeof workspaceRequestSchema>;
export const savedWorkspaceRequestSchema=workspaceRequestSchema.extend({leagueId:z.string().regex(/^league_[a-zA-Z0-9-]+$/)});
export function newSessionShortId(){
  const bytes=crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');
}
export function workspaceRequestRoute(request:WorkspaceRequest,leagueId:string){
  if(request.shortId)return `/s/${request.shortId}${leagueId===defaultLeagueId?'':`?league=${encodeURIComponent(leagueId)}`}`;
  const params=new URLSearchParams({view:'performance',league:leagueId});
  params.set(request.sessionId?'session':'request',request.sessionId??request.id);
  return `/?${params}`;
}
export function workspaceRequestLocation(route:string){
  const url=new URL(route||'/', 'http://workspace.local');
  return {shortId:url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12})$/)?.[1]??null,session:url.searchParams.get('session'),id:url.searchParams.get('request')};
}
