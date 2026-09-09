/**
 * Saved VERSIONS of a project's quote — the "unlimited saves" layer on top
 * of the single live row useStoredState keeps in estimator_kv.
 *
 * The live row is a moving target: every edit overwrites it within half a
 * second, which is the right safety net but means there is no "the quote as
 * it was when I clicked Save yesterday". A version is a full, immutable copy
 * of the quote — drawings included — written to the boma-files Storage
 * bucket (already used by the Vault; see storageFiles.js) under
 * quote-versions/<projectId>/<timestamp>-<source>.json. Storage is where
 * multi-megabyte blobs belong; estimator_kv rows are not.
 *
 * Every explicit Save writes one ("manual"); the autosave timer in
 * ProjectEditor writes one every N minutes while the quote has changed
 * ("autosave"); a Restore writes one of the state it is about to replace
 * ("before-restore") so a restore can itself be undone. Nothing here ever
 * deletes a version.
 *
 * The same JSON shape is what "Save to computer" downloads and "Open .json"
 * reads back, so a file on a laptop and a version in the bucket are
 * interchangeable.
 */
import { supabase, supabaseEnabled } from "./supabaseClient.js";

const BUCKET = "boma-files";
export const FILE_FORMAT = "boma-quote";
export const FILE_FORMAT_VERSION = 1;

export const versionFolder = (projectId) => `quote-versions/${projectId}`;

/** The portable document: what a version file and a downloaded file contain. */
export function buildQuoteFile(projectId, quote, source = "manual") {
  return {
    format: FILE_FORMAT,
    formatVersion: FILE_FORMAT_VERSION,
    app: "BOMA Quotes",
    projectId,
    source,
    savedAt: new Date().toISOString(),
    quote,
  };
}

/** Accepts a parsed file (or the raw text) and returns { projectId, quote,
 * savedAt } — or throws with a plain-English reason. Deliberately strict:
 * the only thing this app will ever import is something it wrote itself. */
export function parseQuoteFile(input) {
  let doc = input;
  if (typeof input === "string") {
    try { doc = JSON.parse(input); } catch { throw new Error("That file isn't valid JSON."); }
  }
  if (!doc || typeof doc !== "object") throw new Error("That file is empty.");
  if (doc.format !== FILE_FORMAT || !doc.quote || typeof doc.quote !== "object") {
    throw new Error("That isn't a BOMA Quotes file (expected one saved by \"Save to computer\" or a version download).");
  }
  if (!Array.isArray(doc.quote.items)) throw new Error("That quote file has no element list — it may be corrupt.");
  return { projectId: doc.projectId || null, quote: doc.quote, savedAt: doc.savedAt || null, source: doc.source || null };
}

const pad = (n) => String(n).padStart(2, "0");
/** "2026-09-08 1432" in LOCAL time — the way an estimator reads a clock. */
export function stampLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}
/** A filename that is safe on Windows and macOS and still reads as the
 * project. ASCII only: Chromium silently drops the WHOLE suggested name and
 * saves as "download" when it contains a character like an em dash or a
 * curly apostrophe (measured), so those are normalised or removed. */
export function quoteFileName(quote, when = new Date()) {
  const base = String(quote?.projectName || "Untitled project")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, "")
    .replace(/[–—―]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled project";
  return `${base} - ${stampLocal(when)}.boma-quote.json`;
}

/* ---------------- bucket-backed versions ---------------- */

/** Writes one immutable version. Resolves { path, savedAt, size } or throws. */
export async function saveVersion(projectId, quote, source = "manual") {
  if (!supabaseEnabled) {
    const err = new Error("Versions need the cloud connection (Supabase) — this install is local-only. Use \"Save to computer\" instead.");
    err.code = "VERSIONS_UNAVAILABLE";
    throw err;
  }
  const doc = buildQuoteFile(projectId, quote, source);
  const text = JSON.stringify(doc);
  // Sortable, unique and readable: 20260908T043212345Z-manual.json
  const iso = doc.savedAt.replace(/[-:]/g, "").replace(".", "");
  const path = `${versionFolder(projectId)}/${iso}-${source}.json`;
  const blob = new Blob([text], { type: "application/json" });
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: "application/json" });
  if (error) throw error;
  return { path, savedAt: doc.savedAt, size: text.length, source };
}

/** Newest first: [{ path, name, savedAt, size, source }]. Empty when unavailable. */
export async function listVersions(projectId) {
  if (!supabaseEnabled) return [];
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(versionFolder(projectId), {
      limit: 1000,
      sortBy: { column: "name", order: "desc" },
    });
    if (error || !data) return [];
    return data
      .filter((f) => f.name.endsWith(".json"))
      .map((f) => {
        const m = f.name.match(/^(\d{8})T(\d{6})(\d*)Z?-([a-z-]+)\.json$/);
        const savedAt = m
          ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}.${(m[3] || "000").padEnd(3, "0")}Z`
          : f.created_at || null;
        return {
          path: `${versionFolder(projectId)}/${f.name}`,
          name: f.name,
          savedAt,
          size: f.metadata?.size ?? 0,
          source: m ? m[4] : "manual",
        };
      })
      .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  } catch {
    return [];
  }
}

/** The full document of one version ({ projectId, quote, savedAt, source }). */
export async function loadVersion(path) {
  if (!supabaseEnabled) throw new Error("Versions need the cloud connection.");
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw error || new Error("Version not found");
  return parseQuoteFile(await data.text());
}

/* ---------------- files on the estimator's own computer ---------------- */

/**
 * Saves the quote as a file on this computer. Where the browser supports it
 * (Chrome/Edge, not inside every embedding), the native "Save as" dialog is
 * used so the estimator picks the folder; otherwise the file goes to the
 * browser's Downloads folder (or wherever its "Ask where to save" setting
 * points). Resolves "picker" | "download" | "cancelled".
 */
export async function downloadQuoteFile(projectId, quote, source = "manual") {
  const doc = buildQuoteFile(projectId, quote, source);
  const text = JSON.stringify(doc, null, 2);
  const filename = quoteFileName(quote);
  // This app runs inside a blob: iframe in the portal. The portal page (the
  // top window) is the same origin, and it is the window the browser trusts
  // for user-facing actions like a Save-as dialog or a download — so both
  // are attempted from there first, then from this window as a fallback.
  const windows = [];
  try { if (window.top && window.top !== window) windows.push(window.top); } catch { /* cross-origin embedding — ignore */ }
  windows.push(window);
  // The Save-as dialog needs a real click behind it (transient user
  // activation). Without one it rejects with the SAME AbortError a person
  // cancelling it produces — so only offer it when activation is present,
  // and otherwise go straight to a plain download, never report "cancelled".
  const activated = typeof navigator !== "undefined" && navigator.userActivation ? navigator.userActivation.isActive === true : true;
  for (const w of activated ? windows : []) {
    if (typeof w.showSaveFilePicker !== "function") continue;
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "BOMA Quotes file", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return "picker";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      // Not permitted from this window — try the next, then a plain download.
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  for (const w of windows) {
    try {
      const d = w.document;
      const url = w.URL.createObjectURL(blob);
      const a = d.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      d.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => w.URL.revokeObjectURL(url), 10000);
      return "download";
    } catch { /* next window */ }
  }
  throw new Error("this browser blocked the download");
}
