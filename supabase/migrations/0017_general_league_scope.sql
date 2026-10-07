-- Generalize future allowance receipts. Preserve historical receipts and existing authority.
create or replace function research_grant(p_student text,p_cycle uuid,p_calls integer,p_games integer,p_expires timestamptz,p_autonomy boolean,p_cost numeric,p_key text)
returns void language plpgsql set search_path=public as $$
declare c research_cycles;
begin
 select * into c from research_cycles where id=p_cycle and student_id=p_student for update;
 if not found then raise exception 'Cycle not found'; end if;
 if exists(select 1 from research_events where student_id=p_student and event_key=p_key) then return; end if;
 if c.state='closed' then raise exception 'Cycle is closed';end if;
 if p_calls<c.calls_allocated or p_games<c.games_allocated then raise exception 'Allowance cannot be smaller than existing allocations'; end if;
 if p_expires<=now() or p_expires>now()+interval '30 days' then raise exception 'Choose an expiry within thirty days'; end if;
 update research_cycles set call_limit=p_calls,game_limit=p_games,expires_at=p_expires,autonomy=p_autonomy,
 cost_review_usd=p_cost,state='active',updated_at=now() where id=c.id;
 perform research_append(p_student,c.id,p_key,'human','allowance.granted',jsonb_build_object('modelCalls',p_calls,'hostedGames',p_games,'expiresAt',p_expires,'autonomy',p_autonomy,'costReviewUsd',p_cost,'scope','GoTA research; no league entry; no automatic promotion'));
end $$;
