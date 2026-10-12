/** Durable turn events remain authoritative while long tools outlive a transport lease. */
export function sessionProgress(events:readonly {type:string;data?:unknown}[],transport:string,starting=false){
  let phase:'starting'|'working'|'input'|'complete'|'failed'|'stopped'|'ended'|'connecting'=starting?'starting':'connecting';
  let activity='Reading your request';
  const labels:Record<string,string>={list_policy_versions:'Loading your saved policies',live_league:'Checking the league',autoresearch:'Checking research',task_status:'Checking existing work',create_view:'Building your view',compose_workspace:'Arranging your workspace',present_view:'Opening evidence',read_file:'Reading policy evidence'};
  for(const event of events){
    const data=event.data as {actions?:{toolName?:string}[];wait?:string}|undefined;
    if(event.type==='message.received'||event.type==='turn.started'){phase='working';activity='Reading your request';}
    if(event.type==='actions.requested'){phase='working';activity=labels[data?.actions?.[0]?.toolName??'']??'Working through your request';}
    if(event.type==='input.requested')phase='input';
    if(event.type==='input.resolved')phase='working';
    if(event.type==='turn.completed')phase='complete';
    if(event.type==='turn.failed'||event.type==='session.failed')phase='failed';
    if(event.type==='turn.cancelled')phase='stopped';
    if(event.type==='session.completed')phase='ended';
    if(event.type==='session.waiting'&&data?.wait==='input-required')phase='input';
    if(event.type==='session.waiting'&&data?.wait==='next-user-message'&&['working','starting','connecting'].includes(phase))phase='complete';
  }
  if(transport==='submitted')phase='working';
  if(transport==='resuming'&&!['complete','failed','stopped','ended','input'].includes(phase))return {phase:'connecting' as const,working:false,label:'Reconnecting to your session'};
  if(transport==='error'&&phase!=='failed')return {phase:'connecting' as const,working:false,label:'Connection interrupted. Reconnect to check progress.'};
  return {phase,working:phase==='working'||phase==='starting',label:phase==='working'?activity:phase==='starting'?'Starting your request':phase==='input'?'Your input is needed':phase==='complete'?'Response ready':phase==='stopped'?'Response stopped':phase==='failed'?'This request needs attention':phase==='ended'?'Session ended':'Connecting to your session'};
}
