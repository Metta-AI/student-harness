import {gameCapabilities} from './game-capabilities';
import type {SessionPanel} from './session-panels';
import {workspaceTemplates} from './templates';

export const newTabOptions = [
  {id:'notes',title:'Notes',description:'Write observations, questions, and ideas.'},
  {id:'game-guide',title:'Game guide',description:'Published rules, policy interface, and starter source.'},
  ...workspaceTemplates.filter(template=>template.id!=='autoresearch').map(({id,title,description})=>({id,title,description})),
];

export const generalTabOptions=[
 {id:'game-guide',title:'Game guide',description:'Published rules, policy interface, and starter source.'},
 {id:'notes',title:'Notes',description:'Write observations, questions, and ideas.'},
 {id:'policy-draft',title:'Policy draft',description:'Draft source or decision rules for this game.'},
 {id:'standings',title:'Standings',description:'Live results for this league.'},
 {id:'rounds',title:'Rounds',description:'Recent rounds and links to game evidence.'},
];
export function tabOptionsForLeague(leagueId?:string){return !leagueId||gameCapabilities(leagueId).policyExecution?newTabOptions:generalTabOptions;}

/** New tabs are local tools; adding one does not start a model turn or research job. */
export function createSessionTab(type:string,title:string,id:string):SessionPanel {
  const option=[...newTabOptions,...generalTabOptions].find(option=>option.id===type);
  if(!option)throw Error('Unknown tab type');
  const name=title.trim()||option.title;
  if(name.length>120)throw Error('Tab names must be 120 characters or fewer');
  if(type==='game-guide')return {id,title:name,kind:'game-guide'};
  if(type==='standings'||type==='rounds')return {id,title:name,kind:'view',view:{view:type==='standings'?'performance':'episodes',last:10,reason:name}};
  if(type==='policy-draft')return {id,title:name,kind:'app',app:{purpose:'Develop a policy for the selected game.',steps:['Draft','Review evidence','Plan a test'],sections:[{id:'draft',title:'Policy draft',blocks:[
    {id:'scope',kind:'text',body:'Draft source or decision rules here. This draft is saved with the conversation; compiling, uploading and running it require a game adapter.'},
    {id:'source',kind:'input',label:'Source or decision rules',multiline:true,placeholder:'Paste your policy or describe its decisions…'},
    {id:'hypothesis',kind:'input',label:'What should improve?',multiline:true},
    {id:'test',kind:'input',label:'How will we test it?',multiline:true},
  ]}]}};
  if(type==='notes')return {id,title:name,kind:'app',app:{
    purpose:'Keep notes with this workspace.',steps:['Capture your observations'],
    sections:[{id:'notes',title:'Notes',blocks:[{id:'notes',kind:'input',label:'Your notes',placeholder:'Write an observation, question, or idea…',multiline:true}]}],
  }};
  const template=workspaceTemplates.find(template=>template.id===type)!;
  return {id,title:name,kind:'app',templateId:template.id,app:structuredClone(template.app)};
}
