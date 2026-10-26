-- Vaani Worker hardening. Review against live schema before applying.
-- Make credit deduction atomic and fail closed on insufficient balance.
create or replace function public.deduct_credits(p_user uuid, p_amount integer, p_ref text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare cur integer;
begin
  if p_amount is null or p_amount < 1 then raise exception 'invalid_credit_amount'; end if;
  select credits into cur from public.profiles where id = p_user and not is_banned for update;
  if cur is null then raise exception 'user_not_found_or_banned'; end if;
  if cur < p_amount then raise exception 'insufficient_credits'; end if;
  update public.profiles set credits = credits - p_amount where id = p_user;
  insert into public.credit_ledger(user_id,delta,reason,ref) values(p_user,-p_amount,'chat',p_ref);
  return cur - p_amount;
end $$;
revoke all on function public.deduct_credits(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.deduct_credits(uuid,integer,text) to service_role;

-- Keep admin adjustment service-role-only. RPC parameter is p_delta, not p_amount.
revoke all on function public.admin_adjust_credits(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.admin_adjust_credits(uuid,integer,text) to service_role;


-- Persist both messages and deduct credits in one transaction.
-- This avoids charging without saving, or saving an uncharged assistant reply, on failures.
create or replace function public.save_chat_and_deduct(
  p_user uuid,
  p_chat uuid,
  p_message text,
  p_answer text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_credits integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cur integer;
begin
  if p_credits is null or p_credits < 1 then raise exception 'invalid_credit_amount'; end if;
  if p_message is null or length(p_message) < 1 or length(p_message) > 8000 then raise exception 'invalid_message'; end if;
  if p_answer is null or length(p_answer) < 1 then raise exception 'invalid_answer'; end if;

  select credits into cur
  from public.profiles
  where id = p_user and not is_banned
  for update;

  if cur is null then raise exception 'user_not_found_or_banned'; end if;
  if cur < p_credits then raise exception 'insufficient_credits'; end if;
  if not exists (select 1 from public.chats where id = p_chat and user_id = p_user) then
    raise exception 'chat_not_found';
  end if;

  update public.profiles set credits = credits - p_credits where id = p_user;
  insert into public.messages(chat_id,user_id,role,content,tokens_in,tokens_out,credits_used)
  values
    (p_chat,p_user,'user',p_message,greatest(coalesce(p_tokens_in,0),0),0,0),
    (p_chat,p_user,'assistant',p_answer,0,greatest(coalesce(p_tokens_out,0),0),p_credits);
  insert into public.credit_ledger(user_id,delta,reason,ref)
  values(p_user,-p_credits,'chat',p_chat::text);
  update public.chats set updated_at = now() where id = p_chat and user_id = p_user;
  return cur - p_credits;
end;
$$;

revoke all on function public.save_chat_and_deduct(uuid,uuid,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.save_chat_and_deduct(uuid,uuid,text,text,integer,integer,integer) to service_role;
