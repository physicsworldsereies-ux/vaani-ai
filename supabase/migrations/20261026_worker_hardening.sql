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
