-- Add cancelled_at field to subscriptions for proper cancellation tracking
-- This enables users to see when they cancelled and supports GDPR/right-to-deletion requests

alter table public.subscriptions
  add_column if not exists cancelled_at timestamptz;

-- Backfill for existing canceled subscriptions (none expected in production yet)
update public.subscriptions
  set cancelled_at = expires_at
where status = 'canceled' and cancelled_at is null;