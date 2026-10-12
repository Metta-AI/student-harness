import { db } from '../db';
import { defaultLeagueId,leagueIdSchema } from '../league-catalog';
import type { Claim } from '../partner/model';
import type { ResearchEvent } from '../research/model';
import { buildCompanionContext, queryWords, type ContextData, type ContextOptions, type ContextSource } from './context';

const windowSize = 80;
const empty = (): ContextData => ({ skills: [], claims: [], memory: [], moments: [], cycles: [], unavailable: [], sourceLimited: false });

/** One bounded retrieval contract for chat, voice, workers, and desktop. No credentials or source blobs. */
export async function readCompanionContext(studentId: string, options: ContextOptions = {}) {
  const data = empty();
  const leagueId=leagueIdSchema.parse(options.leagueId??defaultLeagueId);
  const legacy=leagueId===defaultLeagueId;
  if(!legacy&&process.env.GENERIC_LEARNING_ENABLED!=='1'){
    const disabled=buildCompanionContext({...data,unavailable:['memory']},options);
    return {...disabled,scopeNote:'Shared learning is not enabled for this league; GoTA records are excluded.'};
  }
  if (!studentId) throw new Error('Memory requires an authenticated account');
  const signal = AbortSignal.timeout(8000);
  const client = db();
  const words = queryWords(options.query);
  // Only letters/numbers enter PostgREST filter syntax. No user-supplied operators or wildcard patterns.
  const memorySearch = words.flatMap(w => [`payload->>text.ilike.%${w}%`]).join(',');
  const claimSearch = words.flatMap(w => ['statement', 'situation', 'action', 'falsifier'].map(f => `document->>${f}.ilike.%${w}%`)).join(',');
  const eventScope=legacy?`payload->>leagueId.is.null,payload->>leagueId.eq.${leagueId}`:`and(payload->>leagueId.eq.${leagueId},payload->>studyId.not.is.null)`;
  const claimScope=`document->>leagueId.is.null,document->>leagueId.eq.${defaultLeagueId}`;
  const requests: { source: ContextSource; run: PromiseLike<{ data: unknown; error: unknown }> }[] = legacy?[
    { source: 'claims', run: client.from('partner_claims').select('document').eq('student_id', studentId).or(claimScope).order('updated_at', { ascending: false }).limit(windowSize).abortSignal(signal) },
    { source: 'memory', run: client.from('research_memory').select('*').eq('student_id', studentId).or(eventScope).order('sequence', { ascending: false }).limit(windowSize).abortSignal(signal) },
    { source: 'moments', run: client.from('companion_effective_moments').select('*').eq('student_id', studentId).or(eventScope).order('sequence', { ascending: false }).limit(12).abortSignal(signal) },
    { source: 'cycles', run: client.from('research_cycles').select('id,question,criteria,state,active_version_id').eq('student_id', studentId).neq('state', 'closed').order('created_at', { ascending: false }).limit(8).abortSignal(signal) },
    { source: 'skills', run: client.from('companion_skills').select('id,title,active_version,updated_at').eq('student_id',studentId).eq('status','active').order('updated_at',{ascending:false}).limit(12).abortSignal(signal) },
  ]:[{source:'memory',run:client.from('research_memory').select('*').eq('student_id',studentId).or(eventScope).order('sequence',{ascending:false}).limit(windowSize).abortSignal(signal)}];
  if (words.length&&legacy) requests.push(
    { source: 'claims', run: client.from('partner_claims').select('document').eq('student_id', studentId).or(claimScope).or(claimSearch).order('updated_at', { ascending: false }).limit(windowSize).abortSignal(signal) },
    { source: 'memory', run: client.from('research_memory').select('*').eq('student_id', studentId).or(eventScope).or(memorySearch).order('sequence', { ascending: false }).limit(windowSize).abortSignal(signal) },
    { source: 'moments', run: client.from('companion_effective_moments').select('*').eq('student_id', studentId).or(eventScope).or(memorySearch).order('sequence', { ascending: false }).limit(windowSize).abortSignal(signal) },
  );
  if(words.length&&!legacy)requests.push({source:'memory',run:client.from('research_memory').select('*').eq('student_id',studentId).or(eventScope).or(memorySearch).order('sequence',{ascending:false}).limit(windowSize).abortSignal(signal)});
  const results = await Promise.allSettled(requests.map(r => r.run));
  results.forEach((result, i) => {
    const source = requests[i].source;
    if (result.status === 'rejected' || result.value.error || !Array.isArray(result.value.data)) {
      if (!data.unavailable.includes(source)) data.unavailable.push(source);
      return;
    }
    const rows = result.value.data;
    data.sourceLimited ||= rows.length === windowSize || rows.length === (source === 'moments' || source === 'skills' ? 12 : source === 'cycles' ? 8 : windowSize);
    if (source === 'claims') data.claims.push(...rows.map(r => r.document as Claim));
    else if (source === 'cycles') data.cycles.push(...rows as ContextData['cycles']);
    else if(source==='skills')data.skills!.push(...rows as NonNullable<ContextData['skills']>);
    else data[source].push(...rows as ResearchEvent[]);
  });
  return buildCompanionContext(data, options);
}
