-- Phase 5 follow-up: store last4 of api key for masked admin display
alter table public.payment_gateways
  add column if not exists api_key_last4 text;
