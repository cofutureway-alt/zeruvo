ALTER TABLE public.payment_gateways ADD COLUMN IF NOT EXISTS egp_rate numeric NOT NULL DEFAULT 50;
COMMENT ON COLUMN public.payment_gateways.egp_rate IS 'USD → EGP exchange rate used at checkout time';
