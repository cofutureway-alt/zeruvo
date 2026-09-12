-- Marketing badge for the pricing page: at most one plan is highlighted as
-- "Most popular". Admin-controlled from the plan editor.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS popular boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.plans.popular IS 'Marketing badge: highlight this plan as Most popular on the pricing card';

GRANT SELECT (popular) ON public.plans TO anon, authenticated;

-- Seed: mark the Pro tier as the popular plan.
UPDATE public.plans SET popular = true WHERE name->>'en' = 'Pro';
