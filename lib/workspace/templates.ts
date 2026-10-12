import {codingWorkspacePanels,codingWorkspaceInstructions} from './coding-workspace';
import type {AppActionTarget,AppBlock,MicroApp} from './micro-app';
import type {WorkspaceRequest} from './request';

const evidence=(id:string,name:'strategy'|'episodes'|'opponents'|'experiments'|'performance'|'development',title:string,wikiPage?:'source'|'ontology'|'beliefs'|'evidence'):AppBlock=>({id,kind:'view',view:{view:name,reason:title,last:10,...wikiPage?{wikiPage}:{}}});
const input=(id:string,label:string,placeholder:string,multiline=true):AppBlock=>({id,kind:'input',label,placeholder,multiline});
const choice=(id:string,label:string,options:string[]):AppBlock=>({id,kind:'choice',label,options});
const action=(id:string,label:string,target:AppActionTarget):AppBlock=>({id,kind:'action',label,target,fields:[]});
const view=(name:'strategy'|'episodes'|'opponents'|'experiments'|'performance'|'development',title:string,wikiPage?:'source'|'ontology'|'beliefs'|'evidence'):AppActionTarget=>({kind:'view',view:{view:name,reason:title,last:10,...wikiPage?{wikiPage}:{}}});
type Template={id:string;view:'terminal'|'strategy'|'episodes'|'opponents'|'experiments'|'performance'|'development';category:'Understand'|'Review'|'Improve';title:string;description:string;tabs:string[];setup:string;app:MicroApp};

/** Versioned starting layouts. Each launch gets an independent, editable copy. */
export const workspaceTemplates:Template[]=[
  {id:'autoresearch',view:'terminal',category:'Improve',title:'Autoresearch',description:'A persistent coding workspace. Inspect, edit, test, and repeat.',tabs:['Terminal','Files','Changes'],setup:codingWorkspaceInstructions,app:{purpose:'Improve the policy in a persistent coding workspace.',steps:['Inspect','Edit','Test'],sections:[]}},
  {id:'policy-studio',view:'strategy',category:'Understand',title:'Policy studio',description:'Understand your decisions and shape a better strategy.',tabs:['Strategy','Rules','Evidence'],
    setup:'Read the selected policy source and verify which version is entered in this league. Build a plain-language strategy map in the app with the main decision rules, their source references, and open questions. Never use an old saved revision as if it were the live entry.',
    app:{purpose:'See why your policy makes a decision, then choose what to improve.',steps:['Understand the strategy','Question a decision','Choose a change'],sections:[
      {id:'strategy',title:'How your policy thinks',description:'A strategy map grounded in your actual policy.',blocks:[evidence('strategy-evidence','strategy','Policy strategy')]},
      {id:'question',title:'Explore a decision',blocks:[choice('focus','What would you like to understand?',['Target selection','Movement and positioning','Items and abilities','Objective pressure']),input('question','Your question','Why does my hero leave the lane here?'),action('explain','View policy source',view('development','Policy source','source'))]},
      {id:'direction',title:'Shape the next change',blocks:[input('desired','What should it do differently?','Stay with the wave until we can safely pressure the tower.'),action('proposal','Review saved experiments',view('experiments','Experiments'))]},
    ]}},
  {id:'replay-coaching',view:'episodes',category:'Review',title:'Replay coaching',description:'Turn a moment in a game into useful coaching.',tabs:['Replay','Moments','Coaching'],
    setup:'The episodes block already loads recent games and opens the latest playable replay with coaching controls automatically. Preserve this live block. Inspect selected-policy evidence and add concise game-specific observations with exact episode IDs and timestamps. Do not replace the table with instructions or ask the human to find a replay. Preserve coaching inputs.',
    app:{purpose:'Watch a decision, capture what you noticed, and teach Preston what you would try.',steps:['Watch a game','Capture a moment','Coach a decision'],sections:[
      {id:'watch',title:'Recent games',blocks:[{id:'recent-games',kind:'episodes'}]},
      {id:'moment',title:'Your coaching moment',description:'Keep the observation separate from the behavior you want.',blocks:[input('time','Moment or time','01:20 · Blue hero near the middle tower',false),input('observed','What happened?','My hero chased an enemy while our tower was under pressure.'),input('alternative','What would you do?','Return to defend the tower with the nearby allies.'),action('coach','Open replay and coaching',{kind:'section',sectionId:'watch'})]},
    ]}},
  {id:'opponent-notebook',view:'opponents',category:'Improve',title:'Opponent notebook',description:'Build an evidence-backed picture of your rivals.',tabs:['Policies','Behaviors','Evidence'],
    setup:'Read the selected league standings and existing opponent evidence. Populate this notebook with a few relevant opponents, their exact policy versions, known behaviors and evidence gaps. Distinguish replay observations from hypotheses; do not start analysis sessions during setup.',
    app:{purpose:'Understand how an opponent wins and choose a response worth testing.',steps:['Choose a rival','Collect behavior evidence','Design a response'],sections:[
      {id:'rivals',title:'Who should we learn from?',blocks:[evidence('rival-evidence','opponents','Opponent evidence')]},
      {id:'investigate',title:'Direct the investigation',blocks:[input('opponent','Player or policy','Choose a rival from the findings above.',false),input('behavior','What interests you?','How do they build pressure while avoiding fights?'),action('inspect','Open opponent evidence',view('opponents','Opponent evidence')),action('analyze','Browse recent games',view('episodes','Recent games'))]},
      {id:'counter',title:'Turn learning into a response',blocks:[input('response','Your counter-strategy idea','Could we pressure another lane while they group?'),action('synthesize','Review experiments',view('experiments','Experiments'))]},
    ]}},
  {id:'experiment-bench',view:'experiments',category:'Improve',title:'Experiment bench',description:'Turn an idea into a fair comparison and a decision.',tabs:['Hypotheses','Tests','Results'],
    setup:'Inspect completed experiments and the live baseline for this league. Populate this bench with the latest useful results, what they establish, and what to test next. Opening the bench does not authorize new tests, policy edits or submission.',
    app:{purpose:'Make a prediction, compare against a baseline, and decide what the evidence supports.',steps:['Frame the hypothesis','Design a fair test','Read the result'],sections:[
      {id:'learning',title:'What we already know',blocks:[evidence('test-evidence','experiments','Completed experiments')]},
      {id:'hypothesis',title:'What do you want to try?',blocks:[input('change','Proposed change','Keep a defender near exposed structures while other heroes pressure lanes.'),input('prediction','Why should it help?','Fewer lost defenses without giving up too much objective pressure.'),input('failure','What would change your mind?','Wins fall or games stall more often.'),action('design','Review completed tests',view('experiments','Completed tests'))]},
      {id:'decision',title:'Make the call',blocks:[choice('verdict','Your working decision',['Need more evidence','Keep the current policy','Investigate the candidate']),action('review','Open experiment results',view('experiments','Experiment results'))]},
    ]}},
  {id:'league-dashboard',view:'performance',category:'Review',title:'League dashboard',description:'Understand your standing and what is moving it.',tabs:['Standings','Outcomes','Versions'],
    setup:'Read live standings for the selected league and the selected policy results. Build a concise dashboard in this app, and add a data view if helpful. Label player rating separately from policy results, include sample sizes and recency, and never infer a ranking trend without historical snapshots.',
    app:{purpose:'See how you are doing, what the results mean, and where to look next.',steps:['Check the league','Understand the results','Choose a focus'],sections:[
      {id:'standing',title:'How are we doing?',blocks:[evidence('standing-evidence','performance','League results')]},
      {id:'focus',title:'What would you like to understand?',blocks:[choice('metric','Focus',['Recent losses','Time-limit games','Strongest opponents','Policy version changes']),input('question','Anything you noticed?','We seem to win early fights but struggle to finish games.'),action('investigate','Browse recent games',view('episodes','Recent games'))]},
    ]}},
  {id:'policy-wiki',view:'development',category:'Understand',title:'Policy wiki',description:'Connect concepts, beliefs, and policy decisions.',tabs:['Concepts','Beliefs','Source'],
    setup:'Read the available semantic policy representation and saved beliefs. Build a readable starting wiki in this app linking concepts to policy source and evidence. Distinguish implemented behavior, assumptions and untested ideas; do not fabricate an ontology if none is saved.',
    app:{purpose:'Keep a shared understanding of what the policy does and why we believe it works.',steps:['Explore a concept','Trace its evidence','Refine our understanding'],sections:[
      {id:'map',title:'A map of our understanding',blocks:[evidence('wiki-evidence','development','Policy wiki')]},
      {id:'concept',title:'Explore a concept',blocks:[evidence('concept-evidence','development','Policy concepts','ontology'),input('concept','Concept or behavior','Safe pressure, retreat, target priority…',false)]},
      {id:'belief',title:'Challenge a belief',blocks:[evidence('belief-evidence','development','Policy beliefs','beliefs'),input('belief','What do you believe?','Our heroes should regroup before entering an exposed lane.'),input('evidence','What supports or challenges it?','A replay moment, result, or example you want to discuss.')]},
    ]}},
];

export function instantiateWorkspaceTemplate(templateId:string):Pick<WorkspaceRequest,'prompt'|'mode'|'template'|'workspaceTitle'|'tabs'|'activeTabId'|'appValues'>{
  const template=workspaceTemplates.find(t=>t.id===templateId);
  if(!template)throw new Error('Unknown workspace template');
  if(templateId==='autoresearch')return {template:{id:template.id,version:1},workspaceTitle:template.title,mode:'research',prompt:'Improve my policy through an autoresearch loop in this coding workspace. Inspect the live baseline, choose one supported hypothesis, edit hero.bas, evaluate with hosted games, and keep or revert based on evidence. Continue useful iterations and save progress; do not submit to the league.',tabs:structuredClone(codingWorkspacePanels),activeTabId:'coding-terminal',appValues:{}};
  return {template:{id:template.id,version:1},workspaceTitle:template.title,mode:'auto',
    prompt:`Build a ${template.title.toLowerCase()} app for my current policy. Bring in the available evidence and help me choose what to explore next.`,
    tabs:[{id:'app-home',title:template.title,kind:'app',app:structuredClone(template.app)}],activeTabId:'app-home',appValues:{}};
}

/** Upgrade known starter controls without replacing findings or human values. */
export function nativeTemplateApp(app:MicroApp,templateId?:string):MicroApp {
  const starter=workspaceTemplates.find(t=>t.id===templateId)?.app;
  const actions=new Map(starter?.sections.flatMap(s=>s.blocks).filter(b=>b.kind==='action').map(b=>[b.id,b])??[]);
  return {...app,sections:app.sections.map(section=>({...section,blocks:[...(section.blocks.some(b=>b.kind==='view')?[]:starter?.sections.find(s=>s.id===section.id)?.blocks.filter(b=>b.kind==='view')??[]),...section.blocks.flatMap(block=>{
    if(block.kind==='text'&&['strategy-summary','rivals-summary','results-summary','standing-summary','wiki-summary'].includes(block.id)&&block.body.startsWith('Preston will'))return [];
    if(block.kind!=='action'||block.target)return [block];
    const replacement=actions.get(block.id);
    if(!replacement||replacement.kind!=='action')return [];
    const target=replacement.target;
    if(target?.kind==='section'&&!app.sections.some(s=>s.id===target.sectionId))return [];
    return [replacement];
  })]}))};
}
