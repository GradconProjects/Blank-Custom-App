-- BOMA ESTIMATES: server-side trial meter.
--
-- The portal has no login. A visitor lands and the app opens immediately;
-- what limits them is this table, which counts their sessions and their
-- elapsed hours SERVER-SIDE so that clearing site data doesn't reset the
-- count. See api/trial.js for the rules it enforces.
--
-- Unlike public.estimator_kv (0001) and the boma-files bucket (0002), which
-- deliberately allow the anon key full access, NOTHING here is reachable
-- from the browser. RLS is enabled with no policies at all, so anon and
-- authenticated both get zero rows; only the service_role key bypasses RLS,
-- and that key exists solely as a Vercel server-side environment variable
-- (SUPABASE_SERVICE_ROLE_KEY, no VITE_ prefix) read by api/trial.js. If this
-- table were readable or writable from client code the whole meter would be
-- worthless — a visitor could just zero their own row.

create table if not exists public.trial_visitors (
  id uuid primary key default gen_random_uuid(),

  -- HMAC of the visitor's IP, never the IP itself: this only ever needs to
  -- answer "have I seen this network before", so there's no reason to hold
  -- the address in plaintext.
  ip_hash text not null,

  sessions_used integer not null default 0,
  -- Milliseconds banked from FINISHED sessions only. Time for a session
  -- still in flight is derived from current_started_at at read time, so
  -- closing the tab never hands back free time.
  ms_used bigint not null default 0,

  current_started_at timestamptz,
  current_expires_at timestamptz,

  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- api/trial.js counts recent rows per network before minting a fresh trial,
-- so this lookup happens on every first-contact request.
create index if not exists trial_visitors_ip_hash_idx
  on public.trial_visitors (ip_hash, created_at desc);

alter table public.trial_visitors enable row level security;

-- Intentionally no policies. See the header comment: RLS with zero policies
-- denies anon and authenticated everything, which is exactly what's wanted.
