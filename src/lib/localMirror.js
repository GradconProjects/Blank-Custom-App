/**
 * A per-key localStorage MIRROR of what Supabase last returned, so the next
 * visit can paint from the last-known copy instantly instead of showing a
 * blank screen for the length of a round trip to the database (see
 * storage.js's cacheFirst option and projects.js's readQuotesCached).
 *
 * Rules that keep this from ever being the thing that breaks:
 *   - it is a cache, never a source of truth: the remote row always wins the
 *     moment it arrives (storage.js reconciles on updated_at), and a caller
 *     that gets nothing back simply behaves as it did before the mirror
 *     existed;
 *   - every read and write is guarded — a private window, blocked site data,
 *     or a full quota just means "no cache", never an exception;
 *   - entries are capped in size so a huge value can never evict the portal's
 *     own localStorage state (Estimates sessions, preferences) by filling the
 *     ~5 MB origin quota. Anything over the cap is not mirrored at all;
 *   - keys carry their own prefix so they can never collide with the
 *     localStorage-mode data stored under the bare key on an install without
 *     Supabase (and the legacy migration that reads it).
 */
const PREFIX = "boma-cache:";
export const MAX_MIRROR_BYTES = 700 * 1024;

const store = () => (typeof window !== "undefined" && window.localStorage ? window.localStorage : null);

/** {value, updatedAt} or null. */
export function readMirror(key) {
  try {
    const s = store();
    if (!s) return null;
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("value" in parsed)) return null;
    return { value: parsed.value, updatedAt: parsed.updatedAt || null };
  } catch {
    return null;
  }
}

/** Best-effort; returns true only when the entry was actually written. */
export function writeMirror(key, value, updatedAt) {
  try {
    const s = store();
    if (!s) return false;
    const raw = JSON.stringify({ value, updatedAt: updatedAt || null });
    if (raw.length > MAX_MIRROR_BYTES) {
      // Too big to cache safely — and make sure no smaller, stale copy lingers.
      s.removeItem(PREFIX + key);
      return false;
    }
    s.setItem(PREFIX + key, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearMirror(key) {
  try {
    const s = store();
    if (s) s.removeItem(PREFIX + key);
  } catch {
    /* best-effort */
  }
}
