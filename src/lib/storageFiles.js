/**
 * File storage for the Project Folder feature — per-project document
 * folders plus one shared "Office" folder for company-wide files. Backed
 * by the "boma-files" Supabase Storage bucket (see supabase/migrations/
 * 0002_boma_files_bucket.sql — same "anon full access, no auth" model as
 * public.estimator_kv, not a security boundary, see CLAUDE.md). There is no
 * localStorage fallback here, unlike lib/storage.js's useStoredState — real
 * file bytes can't live in localStorage, so file storage is simply
 * unavailable when Supabase isn't configured (supabaseEnabled === false);
 * callers should check that and tell the estimator why, not silently no-op.
 */
import { supabase, supabaseEnabled } from "./supabaseClient.js";

const BUCKET = "boma-files";

export const OFFICE_FOLDER_PATH = "office";
export const projectFolderPath = (projectId) => `projects/${projectId}`;

/** Lists every file under a folder path, newest first. */
export async function listFiles(folderPath) {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folderPath, { sortBy: { column: "created_at", order: "desc" } });
  if (error || !data) return [];
  return data
    .filter((f) => f.name !== ".emptyFolderPlaceholder")
    .map((f) => {
      const path = `${folderPath}/${f.name}`;
      return {
        name: f.name.replace(/^\d+-/, ""), // strip the timestamp prefix uploadFile() adds
        path,
        size: f.metadata?.size ?? 0,
        uploadedAt: f.created_at,
        url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      };
    });
}

/** Uploads one File (from an <input type="file">) into a folder, under an
 * optional display name (defaults to the file's own name) — this is how a
 * custom name given at upload time is preserved: it becomes the stored
 * filename itself (Supabase Storage's own `list()` has no separate
 * "display name" metadata to lean on instead), stripped of the timestamp
 * prefix again by listFiles() below. Prefixes the stored name with the
 * upload time so two people uploading "drawing.pdf" on different days
 * never collide. */
export async function uploadFile(folderPath, file, displayName) {
  if (!supabaseEnabled) throw new Error("File storage requires this app to be connected to Supabase.");
  const safeName = (displayName || file.name).replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${folderPath}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function deleteFile(path) {
  if (!supabaseEnabled) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

export function monthLabel(iso) {
  return new Date(iso).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}
export function dayLabel(iso) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** Folds a flat, newest-first file list (as returned by listFiles) into
 * Month -> Day -> files groups, both levels newest first — the "rolled up
 * folded according to days and months" browsing structure. */
export function groupFilesByMonthDay(files) {
  const byMonth = new Map();
  files.forEach((f) => {
    const month = monthLabel(f.uploadedAt);
    const dateKey = (f.uploadedAt || "").slice(0, 10);
    const day = dayLabel(f.uploadedAt);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const byDay = byMonth.get(month);
    if (!byDay.has(dateKey)) byDay.set(dateKey, { day, dateKey, files: [] });
    byDay.get(dateKey).files.push(f);
  });
  return [...byMonth.entries()]
    .map(([month, byDay]) => ({
      month,
      days: [...byDay.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    }))
    .sort((a, b) => (b.days[0]?.dateKey || "").localeCompare(a.days[0]?.dateKey || ""));
}

export function formatFileSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
