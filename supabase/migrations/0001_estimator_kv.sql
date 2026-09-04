-- Gradcon Estimator: shared key/value store backing useStoredState
-- (src/lib/storage.js). Mirrors the app's previous localStorage keys
-- (gradcon-projects, gradcon-rates, gradcon-quote-<id>) so every
-- browser/device reads and writes the same rows instead of separate
-- per-browser copies. Run this against your Supabase project via the SQL
-- editor, or `supabase db push` if you use the CLI.

create table if not exists public.estimator_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.estimator_kv enable row level security;

-- No auth in this app (see CLAUDE.md -> "Known limitations") — anyone
-- holding the anon/publishable key can read and write every row. That
-- matches the app's existing "no login" design, just shared across
-- devices instead of confined to one browser. Tighten this (e.g. require
-- auth.uid()) if the app ever grows real user accounts.
create policy "anon read/write" on public.estimator_kv
  for all
  to anon
  using (true)
  with check (true);
