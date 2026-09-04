-- BOMA ESTIMATES: file storage for the Project Folder feature (per-project
-- documents + a shared "Office" folder for company-wide files). Mirrors the
-- same "anon full access, no auth" model already accepted for
-- public.estimator_kv (see 0001_estimator_kv.sql and CLAUDE.md -> "Known
-- limitations") — this is an internal tool with no login, not a security
-- boundary. Public bucket so plain object URLs work directly in <a>/<img>
-- without a signed-URL round trip.
--
-- Path convention (enforced by the app, not the database):
--   projects/<projectId>/<timestamp>-<filename>  — one project's own folder
--   office/<timestamp>-<filename>                — company-wide Office folder
-- Supabase Storage requires no folder to be created ahead of time; a path
-- prefix comes into existence the moment the first object is uploaded under
-- it, and lib/storageFiles.js lists objects by prefix rather than relying on
-- a separate folder record.

-- Renamed from the previous "gradcon-files" bucket. This migration only
-- CREATES the new bucket; it does not move objects. A project that was
-- already storing files under the old bucket needs those objects copied
-- across (Supabase dashboard, or the Storage API) — unlike the localStorage
-- keys, which src/lib/legacyKeys.js carries over automatically.

insert into storage.buckets (id, name, public)
values ('boma-files', 'boma-files', true)
on conflict (id) do nothing;

create policy "anon read/write boma-files"
  on storage.objects
  for all
  to anon
  using (bucket_id = 'boma-files')
  with check (bucket_id = 'boma-files');
