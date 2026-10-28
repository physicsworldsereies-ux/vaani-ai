-- Security hardening found during the live Supabase audit.
-- The Worker uses the service role for admin checks. The exposed is_admin()
-- SECURITY DEFINER RPC is only needed by authenticated RLS policies, never anon.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Razorpay payment identifiers must not be reused across different orders.
-- Existing NULL values for unpaid orders are intentionally allowed.
CREATE UNIQUE INDEX IF NOT EXISTS orders_razorpay_payment_id_unique
  ON public.orders (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
