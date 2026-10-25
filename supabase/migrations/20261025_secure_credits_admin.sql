-- Vaani security hardening. Review before applying to production.
-- Frontend writes are moved behind the authenticated vaani-api Edge Function.

-- Remove broad client grants, then allow only what the browser needs to read.
REVOKE ALL ON TABLE public.profiles, public.chats, public.messages, public.credit_packs,
  public.orders, public.credit_ledger, public.app_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles, public.chats, public.messages, public.orders, public.credit_ledger TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.credit_packs TO anon, authenticated;

-- Keep RLS enabled and narrow policies to signed-in users where appropriate.
DROP POLICY IF EXISTS "chats: own" ON public.chats;
CREATE POLICY "chats: read own" ON public.chats FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "messages: read own" ON public.messages;
CREATE POLICY "messages: read own" ON public.messages FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "profile: read own or admin" ON public.profiles;
CREATE POLICY "profile: read own or admin" ON public.profiles FOR SELECT TO authenticated USING (id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "profile: update own" ON public.profiles;
CREATE POLICY "profile: update own" ON public.profiles FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "ledger: read own or admin" ON public.credit_ledger;
CREATE POLICY "ledger: read own or admin" ON public.credit_ledger FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "orders: read own or admin" ON public.orders;
CREATE POLICY "orders: read own or admin" ON public.orders FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "packs: public read" ON public.credit_packs;
CREATE POLICY "packs: public read" ON public.credit_packs FOR SELECT TO anon, authenticated USING (active = true);

-- is_admin must never be callable by anonymous visitors.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO service_role;
REVOKE ALL ON FUNCTION public.deduct_credits(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.fulfill_order(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_order(text, text) TO service_role;

-- Credit debits are atomic and cannot silently charge less than the computed amount.
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user uuid, p_amount integer, p_ref text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_credit_amount'; END IF;
  SELECT credits INTO cur FROM public.profiles WHERE id = p_user AND NOT is_banned FOR UPDATE;
  IF cur IS NULL THEN RAISE EXCEPTION 'user_not_found_or_banned'; END IF;
  IF cur < p_amount THEN RAISE EXCEPTION 'insufficient_credits'; END IF;
  UPDATE public.profiles SET credits = credits - p_amount WHERE id = p_user;
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref) VALUES (p_user, -p_amount, 'chat', p_ref);
  RETURN cur - p_amount;
END $$;

-- Admin credit adjustments are server-only. Edge Function verifies the admin session first.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(p_user uuid, p_amount integer, p_reason text DEFAULT 'admin_adjustment')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN RAISE EXCEPTION 'invalid_credit_amount'; END IF;
  UPDATE public.profiles SET credits = credits + p_amount WHERE id = p_user AND NOT is_banned RETURNING credits INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'user_not_found_or_banned'; END IF;
  INSERT INTO public.credit_ledger (user_id, delta, reason) VALUES (p_user, p_amount, left(coalesce(p_reason, 'admin_adjustment'), 80));
  RETURN new_balance;
END $$;
REVOKE ALL ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) TO service_role;

-- Supporting indexes for foreign-key lookups flagged by the advisor.
CREATE INDEX IF NOT EXISTS messages_user_id_idx ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS orders_pack_id_idx ON public.orders(pack_id);


-- Accurate global admin metrics; only the service-role Edge Function may execute this.
CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN json_build_object(
    'users', (SELECT count(*) FROM public.profiles),
    'banned', (SELECT count(*) FROM public.profiles WHERE is_banned),
    'revenue_inr', (SELECT coalesce(sum(amount_paise), 0) / 100.0 FROM public.orders WHERE status = 'paid'),
    'credits_used', (SELECT coalesce(-sum(delta), 0) FROM public.credit_ledger WHERE reason = 'chat' AND delta < 0),
    'messages', (SELECT count(*) FROM public.messages)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO service_role;
