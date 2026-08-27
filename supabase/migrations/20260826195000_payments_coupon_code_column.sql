-- Add coupon_code column to payments so checkout can record which coupon was applied
-- The kashier-webhook reads payment.meta.coupon_code, but the checkout insert
-- also writes coupon_code at the top level for easy querying.
ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS coupon_code text;

-- Index for admin coupon analytics (e.g. "show all payments using code X")
CREATE INDEX IF NOT EXISTS idx_payments_coupon_code ON public.payments (coupon_code)
WHERE coupon_code IS NOT NULL;
