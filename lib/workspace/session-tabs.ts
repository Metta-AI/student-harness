import {viewPanel,type SessionPanel} from './session-panels';

// Closing hides a panel; its artifact, notes, and subsequent updates stay available.
export function panelKey(panel:SessionPanel):string {
  switch(panel.kind){
    case 'policy':return 'policy';
    case 'replay':return `replay:${panel.episodeId}`;
    case 'research':return `research:${panel.taskId}`;
    case 'terminal':return `terminal:${panel.panel}`;
    case 'view':return `view:${viewPanel(panel.view).id}`;
    case 'app':return `app:${panel.id}`;
    case 'game-guide':return `game-guide:${panel.id}`;
  }
}
export function openSessionTabs(panels:SessionPanel[],closed:string[]){return panels.filter(panel=>!closed.includes(panelKey(panel)));}
export function closeSessionTabs(panels:SessionPanel[],closed:string[],activeId:string,ids:string[]){
  const open=openSessionTabs(panels,closed),index=open.findIndex(panel=>panel.id===activeId);
  const keys=panels.filter(panel=>ids.includes(panel.id)).map(panelKey);
  const next=[...closed.filter(key=>!keys.includes(key)),...keys];
  const remaining=openSessionTabs(panels,next);
  const active=remaining.some(panel=>panel.id===activeId)?activeId:open.slice(Math.max(0,index+1)).find(panel=>!ids.includes(panel.id))?.id??open.slice(0,index).reverse().find(panel=>!ids.includes(panel.id))?.id??remaining[0]?.id??'';
  return {closed:next,activeId:active};
}
