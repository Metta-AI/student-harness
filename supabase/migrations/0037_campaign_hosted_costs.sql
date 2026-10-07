-- Persist reported hosted costs separately from model usage. Missing prices
-- remain unknown; repeated receipt polls must never double-count a game.
create function campaign_attempt_cost() returns trigger language plpgsql set search_path=public as $$
declare owner_id text; cost jsonb;
begin
 cost:=new.receipt->'episode'->'cost_usd';
 if new.receipt->'episode'->>'status' in ('completed','failed','error','canceled','cancelled')
    and jsonb_typeof(cost)='number' and (cost::text)::numeric>=0 then
  select student_id into owner_id from research_studies where id=new.study_id;
  perform research_daily_settle(owner_id,'study:'||new.request_key,(cost::text)::numeric);
 end if;
 return new;
end $$;
create trigger campaign_hosted_cost after insert or update of receipt on research_attempts
for each row execute function campaign_attempt_cost();

update research_daily_usage u set cost_usd=(a.receipt->'episode'->>'cost_usd')::numeric
from research_attempts a join research_studies s on s.id=a.study_id
where u.student_id=s.student_id and u.operation_key='study:'||a.request_key and u.cost_usd is null
and a.receipt->'episode'->>'status' in ('completed','failed','error','canceled','cancelled')
and jsonb_typeof(a.receipt->'episode'->'cost_usd')='number'
and (a.receipt->'episode'->>'cost_usd')::numeric>=0;

create function campaign_hosted_usage(p_id uuid,p_student text) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object(
  'reportedUsd',coalesce(sum(u.cost_usd),0),
  'costReports',count(u.cost_usd),
  'requests',count(a.xp_id))
 from research_campaigns c join research_studies s on s.campaign_id=c.id
 join research_attempts a on a.study_id=s.id
 left join research_daily_usage u on u.student_id=s.student_id and u.operation_key='study:'||a.request_key
 where c.id=p_id and c.student_id=p_student;
$$;
revoke all on function campaign_attempt_cost(),campaign_hosted_usage(uuid,text) from public,anon,authenticated;
grant execute on function campaign_hosted_usage(uuid,text) to service_role;
notify pgrst,'reload schema';
