-- Authorise job actions with a capability token instead of re-deriving the
-- visitor's identity hash inside the Python function. The two runtimes see
-- proxy headers differently, so agreement on x-forwarded-for / user-agent was
-- never something to rely on for an authorisation check. The token is minted
-- once when the job is created and handed only to that browser.
alter table public.jobs
  add column access_token uuid not null default gen_random_uuid();
