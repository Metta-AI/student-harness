-- Campaign preferences can change for future children; every created session
-- still retains its immutable model/effort snapshot.
alter table research_campaigns add column model_selection jsonb;
update research_campaigns c set model_selection=t.model_selection from agent_tasks t where t.id=c.task_id;
alter table research_campaigns alter column model_selection set not null;
alter table research_campaigns add constraint campaign_model_selection_valid check (coalesce(
 jsonb_typeof(model_selection)='object' and model_selection ?& array['model','effort'] and
 model_selection->>'model' in ('gpt-6-astra','gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5') and
 model_selection->>'effort' in ('low','medium','high','xhigh')
,false));
create function campaign_select_model() returns trigger language plpgsql set search_path=public as $$
begin
 if new.model_selection is null then
  select model_selection into new.model_selection from agent_tasks where id=new.task_id and student_id=new.student_id;
 end if;
 return new;
end $$;
create trigger campaign_model_selection before insert on research_campaigns for each row execute function campaign_select_model();

create or replace function task_select_model() returns trigger language plpgsql set search_path=public as $$
declare selected jsonb;
begin
 if new.context->>'campaignId' is not null then
  select model_selection into selected from research_campaigns
   where id=(new.context->>'campaignId')::uuid and student_id=new.student_id;
  if selected is null then raise exception 'Campaign model selection unavailable'; end if;
 else
  select jsonb_build_object('model',chat_model,'effort',reasoning_effort) into selected from students where subject_id=new.student_id;
 end if;
 new.model_selection:=selected;
 return new;
end $$;

create function campaign_set_model(p_id uuid,p_student text,p_selection jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c research_campaigns;
begin
 select * into c from research_campaigns where id=p_id and student_id=p_student for update;
 if not found then raise exception 'Campaign not found'; end if;
 if c.state not in ('active','paused') then raise exception 'Campaign has ended';end if;
 update research_campaigns set model_selection=p_selection,updated_at=now() where id=c.id;
 if c.model_selection is distinct from p_selection then
  insert into research_campaign_events(campaign_id,event_key,kind,payload)
  values(c.id,'model:'||gen_random_uuid(),'model.changed',jsonb_build_object('message','Model changed for future sessions','before',c.model_selection,'after',p_selection));
 end if;
 return p_selection;
end $$;
revoke all on function campaign_select_model(),campaign_set_model(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function campaign_set_model(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
