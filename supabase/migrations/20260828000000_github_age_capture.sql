-- Phase 10: Server-side GitHub account age capture
-- This function can be called from the gateway Worker's auth flow
-- or from a dedicated edge function after OAuth completion

-- Function to capture GitHub creation date from provider token
create or replace function public.capture_github_created_at(
  p_user_id uuid,
  p_provider_token text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  github_created text;
  response json;
begin
  -- Only for GitHub identities
  if p_provider_token is null then
    return;
  end if;

  -- Fetch GitHub user data using the provider token
  -- Note: This requires a server extension or HTTP client
  -- In production, this is better handled in an Edge Function
  -- This SQL stub documents the intended behavior

  -- The actual implementation should be in an Edge Function:
  -- GET https://api.github.com/user
  -- Authorization: Bearer <provider_token>
  -- Parse response.created_at and store in profiles.github_created_at

  null; -- Placeholder - real implementation in edge function
end;
$$;

-- Grant execute to service_role (gateway worker)
grant execute on function public.capture_github_created_at(uuid, text) to service_role;

-- Migration note: The actual capture happens in the browser via auth-context.tsx
-- A server-side edge function could be added at:
-- supabase/functions/capture-github-age/index.ts
-- This would be triggered after successful GitHub OAuth via a post-auth hook