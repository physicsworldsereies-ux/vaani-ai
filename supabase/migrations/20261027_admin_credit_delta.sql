-- Fix named RPC argument mismatch and safely support positive/negative admin credit adjustments.
-- Apply only after reviewing against the current live schema.
drop function if exists public.admin_adjust_credits(uuid, integer, text);

create function public.admin_adjust_credits(
  p_user uuid,
  p_delta integer,
  p_reason text default 'admin_adjust'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  new_balance integer;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'invalid_credit_delta';
  end if;

  select credits into current_balance
  from public.profiles
  where id = p_user and not is_banned
  for update;

  if current_balance is null then
    raise exception 'user_not_found_or_banned';
  end if;

  new_balance := current_balance + p_delta;
  if new_balance < 0 then
    raise exception 'insufficient_credits';
  end if;

  update public.profiles set credits = new_balance where id = p_user;
  insert into public.credit_ledger(user_id, delta, reason, ref)
  values(p_user, p_delta, left(coalesce(p_reason, 'admin_adjust'), 80), 'admin-panel');

  return new_balance;
end;
$$;

revoke all on function public.admin_adjust_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to service_role;
