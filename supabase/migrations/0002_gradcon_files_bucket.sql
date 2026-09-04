-- Gradcon Estimator: file storage for the Project Folder feature (per-project
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

insert into storage.buckets (id, name, public)
values ('gradcon-files', 'gradcon-files', true)
on conflict (id) do nothing;

create policy "anon read/write gradcon-files"
  on storage.objects
  for all
  to anon
  using (bucket_id = 'gradcon-files')
  with check (bucket_id = 'gradcon-files');
