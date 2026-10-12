import {defaultLeagueId,leagueIdSchema} from '../league-catalog';
import {learningAvailable} from './learning-availability';
import { db } from '../db';
import { canRunBackground } from '../research/execution-control';
import type { CompanionMutation, ResponsibilityFeed } from './responsibilities';

export async function readResponsibilities(student: string, leagueId=defaultLeagueId): Promise<ResponsibilityFeed> {
  leagueId=leagueIdSchema.parse(leagueId);
  const reviewsEnabled=learningAvailable(leagueId,process.env.GENERIC_LEARNING_ENABLED==='1');
  const [responsibilities, finished, updates, attention, held] = await Promise.all([
    db().from('companion_responsibilities').select('*').eq('student_id',student).eq('league_id',leagueId).neq('status','completed').order('created_at',{ascending:false}).limit(20),
    db().from('companion_responsibilities').select('*').eq('student_id',student).eq('league_id',leagueId).eq('status','completed').order('created_at',{ascending:false}).limit(20),
    db().from('companion_updates').select('*').eq('student_id',student).eq('league_id',leagueId).is('dismissed_at',null).order('created_at',{ascending:false}).limit(50),
    db().from('companion_attention').select('*').eq('student_id',student).maybeSingle(),
    canRunBackground(student).then(allowed => !allowed),
  ]);
  for (const result of [responsibilities,finished,updates,attention]) if (result.error) throw new Error('Between-visit work is unavailable. Check the companion migration and retry.');
  return { leagueId, reviewsEnabled, responsibilities:[...responsibilities.data??[],...finished.data??[]], updates:updates.data??[], attention:attention.data, held };
}

export async function mutateResponsibility(student: string, input: CompanionMutation, leagueId=defaultLeagueId) {
  leagueId=leagueIdSchema.parse(leagueId);
  if(['create','edit','resume'].includes(input.action)&&!learningAvailable(leagueId,process.env.GENERIC_LEARNING_ENABLED==='1'))throw Error('Between-visit reviews are not enabled for this game.');
  if (input.action==='create' || input.action==='edit') {
    if(leagueId!==defaultLeagueId&&(input.input.followUpExperiments||['external.observation','experiment.finished'].includes(input.input.triggerKind)))throw Error('This game supports evidence reviews; automated experiments and external triggers are not available.');
    const result = await db().rpc('companion_save_responsibility_scoped', { p_student:student,p_league:leagueId,p_input:input.input,
      p_id:input.action==='edit'?input.id:null,p_revision:input.action==='edit'?input.revision:null });
    if(result.error) throw new Error(result.error.message);
  } else if(input.action==='pause'||input.action==='resume'||input.action==='stop') {
    const result=await db().rpc('companion_control_responsibility_scoped',{p_student:student,p_league:leagueId,p_id:input.id,p_revision:input.revision,p_action:input.action});
    if(result.error) throw new Error(result.error.message);
  } else if(input.action==='attention') {
    const a=input.input;
    const result=await db().from('companion_attention').upsert({student_id:student,timezone:a.timezone,
      quiet_start:a.quietStart,quiet_end:a.quietEnd,activity:a.activity,
      activity_until:a.activity==='available'?null:new Date(Date.now()+a.durationMinutes*60000).toISOString()});
    if(result.error) throw new Error(result.error.message);
  } else if(input.action==='read'||input.action==='dismiss') {
    const result=await db().from('companion_updates').update(input.action==='read'?{read_at:new Date().toISOString()}:{dismissed_at:new Date().toISOString()})
      .eq('student_id',student).eq('league_id',leagueId).eq('id',input.id).select('id').maybeSingle();
    if(result.error || !result.data) throw new Error('Update not found');
  }
  return readResponsibilities(student,leagueId);
}

export async function dispatchResponsibilities() {
  const result=await db().rpc('companion_dispatch_scoped',{p_generic_enabled:process.env.GENERIC_LEARNING_ENABLED==='1'});
  if(result.error) throw new Error(`Companion dispatch failed: ${result.error.message}`);
  return result.data as number;
}
