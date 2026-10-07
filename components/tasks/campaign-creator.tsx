"use client";
import {useRef,useState} from 'react';
import {ArrowRight,Check,ChevronLeft} from 'lucide-react';
import {LearningSketch} from '../partner/learning-sketch';
import {defaultLeagueId} from '../../lib/league-catalog';

const paths=[
 {id:'league',sketch:'compare',title:'Climb the leaderboard',description:'Find improvements, test them against our current policy, and keep what works.',prompt:'Improve our policy’s ranking in the default GoTA league. Find the strongest opportunities from current league evidence and run matched experiments. Use episode score for faster feedback, but optimize for league performance.',suggestions:['Improve our overall league performance','Turn more time-limit games into wins','Improve consistency against top players']},
 {id:'opponents',sketch:'question',title:'Learn from opponents',description:'Model how rivals play, then turn their strengths and weaknesses into policy experiments.',prompt:'Improve our league performance by modeling the strongest current opponents from replay evidence. Combine useful behaviors and counter-strategies into tested policy candidates. Distinguish observed actions from inferred intent.',suggestions:['Study the top three opponents','Find strategies our policy struggles against','Combine the strongest opponent behaviors']},
 {id:'replays',sketch:'watch',title:'Solve a recurring weakness',description:'Start with something you noticed in a replay and test a better approach.',prompt:'Investigate why our policy fails to convert promising games into wins. Inspect replay evidence, distinguish causes from correlations, and test targeted policy improvements against our current champion.',suggestions:['Why do we lose early fights?','Why do we stall before destroying the fort?','Improve recovery after a hero dies']},
] as const;
const journey=[{kind:'watch',label:'Inspect evidence'},{kind:'question',label:'Model behavior'},{kind:'try',label:'Test candidates'},{kind:'compare',label:'Compare & learn'}] as const;

export function CampaignCreator({onCreated}:{onCreated:(taskId:string)=>void}){
 const [step,setStep]=useState(0),[path,setPath]=useState<typeof paths[number]>(paths[0]),[direction,setDirection]=useState('');
 const [continuous,setContinuous]=useState(true),[promote,setPromote]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const requestKey=useRef<string|null>(null);
 const objective=direction.trim();
 function change(){requestKey.current=null;setError('');}
 async function launch(){
  if(busy)return;setBusy(true);setError('');requestKey.current??=crypto.randomUUID();
  try{
   const response=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({leagueId:defaultLeagueId,objective,requestKey:requestKey.current,protocol:{screenPairs:40,confirmationPairs:256,gate:'confidence',fixtureMode:'fresh-seeds',continuous,promote}})});
   const body=await response.json();if(!response.ok)throw Error(body.error??'Could not start the campaign.');
   window.dispatchEvent(new Event('background-work-updated'));onCreated(body.campaign.task_id);
  }catch(cause){setError(cause instanceof Error&&cause.name!=='TimeoutError'?cause.message:'Still waiting for a response. Retry to check the same campaign; it will not create a duplicate.');}
  finally{setBusy(false);}
 }
 return <section className="campaign-creator" aria-label="Create a campaign">
  <ol className="campaign-creator-steps" aria-label="Campaign setup">{['Choose a direction','Make it yours','Start exploring'].map((label,i)=><li key={label} aria-current={step===i?'step':undefined}><span>{i<step?<Check size={12}/>:i+1}</span>{label}</li>)}</ol>
  {step===0?<>
   <h2>What would you like to improve?</h2><p>Choose a starting point. Preston handles the research sessions and experiments.</p>
   <div className="campaign-paths">{paths.map(option=><button type="button" key={option.id} onClick={()=>{setPath(option);setDirection(option.prompt);change();setStep(1);}}><LearningSketch kind={option.sketch}/><strong>{option.title}</strong><span>{option.description}</span><small>Explore this <ArrowRight size={14}/></small></button>)}</div>
  </>:step===1?<>
   <div className="campaign-direction-heading"><LearningSketch kind={path.sketch}/><div><h2>{path.title}</h2><p>Use this direction, or tell Preston what matters to you.</p></div></div>
   <label htmlFor="campaign-direction">Your direction</label><textarea id="campaign-direction" value={direction} maxLength={5000} rows={4} onChange={e=>{setDirection(e.target.value);change();}}/>
   <div className="campaign-suggestions">{path.suggestions.map(suggestion=><button key={suggestion} type="button" onClick={()=>{setDirection(`${path.prompt}\n\nFocus: ${suggestion}.`);change();}}>{suggestion}</button>)}</div>
   <div className="campaign-creator-actions"><button className="text-button" onClick={()=>setStep(0)}><ChevronLeft size={14}/>Back</button><button className="starter-cta" disabled={objective.length<12} onClick={()=>setStep(2)}>See the plan <ArrowRight size={14}/></button></div>
  </>:<>
   <h2>Here’s how Preston will work</h2><p className="campaign-chosen-direction">{objective}</p>
   <ol className="campaign-journey">{journey.map((item,i)=><li key={item.kind}><LearningSketch kind={item.kind}/><span>{item.label}</span>{i<journey.length-1?<ArrowRight className="campaign-journey-arrow" size={16}/>:null}</li>)}</ol>
   <p>Sessions share findings. Candidates face matched tests and independent confirmation before promotion.</p>
   <div className="campaign-launch-options"><label><input type="checkbox" checked={continuous} disabled={busy} onChange={e=>{setContinuous(e.target.checked);change();}}/>Keep learning across research cycles</label><label><input type="checkbox" checked={promote} disabled={busy} onChange={e=>{setPromote(e.target.checked);change();}}/>Submit candidates that pass validation to the league</label></div>
   <details className="campaign-test-plan"><summary>Test plan & usage</summary><p>40 matched screening pairs, followed by 256 independent confirmation pairs. Promotion requires the confidence gate to pass. Model and hosted-game spending are tracked.</p></details>
   {error?<p className="tasks-error" role="alert">{error}</p>:null}
   <div className="campaign-creator-actions"><button className="text-button" disabled={busy} onClick={()=>setStep(1)}><ChevronLeft size={14}/>Adjust direction</button><button className="starter-cta" disabled={busy} aria-busy={busy} onClick={()=>void launch()}>{busy?'Starting campaign…':error?'Retry campaign':'Start campaign'}<ArrowRight size={14}/></button></div>
  </>}
 </section>;
}
