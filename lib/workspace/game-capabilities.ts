import {defaultLeagueId} from '../league-catalog';
import type {SessionPanel} from './session-panels';
import type {WorkspaceView} from './presentation';

/** Capabilities describe implemented adapters, never inferred from a game's name. */
export function gameCapabilities(leagueId:string) {
  return {policyExecution:leagueId===defaultLeagueId,conversation:true,documents:true,standings:true,rounds:true,hostedReplay:true};
}
export function supportsGameView(leagueId:string,view:WorkspaceView) {
  return gameCapabilities(leagueId).policyExecution ||
    (['performance','episodes','custom'].includes(view.view)&&!view.revision&&!view.branchId&&!view.cycleId&&!view.experimentId&&!view.opponentPolicyId);
}
export function supportsGamePanel(leagueId:string,panel:SessionPanel):boolean {
  if(gameCapabilities(leagueId).policyExecution)return true;
  if(panel.kind==='game-guide')return true;
  if(panel.kind==='view')return supportsGameView(leagueId,panel.view);
  if(panel.kind==='replay')return !!panel.episodeId&&!panel.policyVersionId&&!panel.runId;
  if(panel.kind!=='app')return false;
  return panel.app.sections.every(section=>section.blocks.every(block=>
    block.kind==='episodes'?false:block.kind==='view'?supportsGameView(leagueId,block.view):
    block.kind==='action'&&block.target?.kind==='view'?supportsGameView(leagueId,block.target.view):true));
}
export function gameWorkspacePanels():SessionPanel[] {
  return [{id:'league-context',title:'League',kind:'view',view:{view:'performance',last:10,reason:'League standings'}}];
}
