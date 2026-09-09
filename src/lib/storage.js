import { useState, useEffect, useRef } from "react";
import { supabase, supabaseEnabled } from "./supabaseClient.js";
import { readMirror, writeMirror, clearMirror } from "./localMirror.js";

const TABLE = "estimator_kv";

/**
 * Persists React state under `key`, debounced so rapid typing doesn't
 * hammer storage. Returns [value, setValue, status] where status is one
 * of: "loading" | "syncing" | "saved" | "saving" | "error" | "unavailable".
 *
 * `options.cacheFirst` (Supabase only): paint from the localStorage mirror
 * of what the database last returned for this key, THEN fetch the real row
 * and reconcile. While the mirror is on screen the status is "syncing" —
 * a value is showing and edits to it save normally, but anything that
 * should only ever run against the confirmed remote copy (one-off
 * migrations in App.jsx) must wait for "saved". Opt-in on purpose: it is
 * only right for values whose mirror is COMPLETE (the projects index, the
 * rates blob). A project's quote is never cache-first — its mirror would
 * have to drop the markup drawings to fit, and a save made against a copy
 * missing them would silently delete the drawings.
 *
 * Backed by Supabase (shared across every browser/device — see
 * lib/supabaseClient.js) when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 * configured; otherwise falls back to per-browser localStorage, so the app
 * still works with no Supabase project set up. Every caller gets the same
 * [value, setValue, status] shape regardless of which backend is active —
 * that's deliberate (see CLAUDE.md → "Known limitations") so components
 * never need to know or care which one is in use.
 */
export function useStoredState(key, initial, { cacheFirst = false } = {}) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState("loading");
  const loadedRef = useRef(false);
  const saveTimer = useRef(null);
  // True from the moment a debounced save's timer fires until its upsert
  // has settled. Together with saveTimer this is the ONE definition of "a
  // local edit is in flight": the poll, the realtime push and the cache-
  // first reconcile all consult it, so none of them can drop a remote value
  // into state on top of something this browser is in the middle of
  // writing (which would leave the screen and the database disagreeing
  // until the next change). The timer handle itself is cleared when it
  // fires — it used to be left set, which silently switched the poll off
  // for good after the first edit of a session.
  const savingRef = useRef(false);
  const localEditPending = () => !!saveTimer.current || savingRef.current;
  // A failed save is retried on its own — 5 s, 15 s, 30 s, then every 60 s —
  // until one succeeds or a newer edit starts a fresh save. Before this, one
  // failed attempt left the status on "error" and the data only in this
  // tab's memory until the next keystroke happened to trigger another try;
  // a whole project could be typed up and never reach the database.
  const retryTimer = useRef(null);
  const retryCount = useRef(0);
  const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];
  const scheduleRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = RETRY_DELAYS_MS[Math.min(retryCount.current, RETRY_DELAYS_MS.length - 1)];
    retryCount.current += 1;
    retryTimer.current = setTimeout(() => { retryTimer.current = null; doSave(); }, delay);
  };
  const clearRetry = () => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    retryCount.current = 0;
  };
  // Tracks the updated_at of whatever value this browser currently holds (set on
  // load and on every save) — the poll effect below compares against it so a
  // fetch that just echoes this browser's own last write is a no-op, and a
  // genuinely newer write from elsewhere is the only thing that ever gets applied.
  const lastSyncedAtRef = useRef(null);
  // Set right before setValue() is called from the initial load or from the poll —
  // i.e. whenever `value` is about to change for a reason OTHER than the app/user
  // actually editing something. Without this, the debounced-save effect below (which
  // only looks at "did value change") can't tell the difference and re-uploads
  // whatever was just pulled down with a brand new timestamp. That's more than just
  // wasted writes: the fresh timestamp can end up NEWER than a genuine edit someone
  // else makes in the same few hundred milliseconds, so this browser's next poll
  // wrongly treats its own echoed copy as "already up to date" and ignores the real
  // edit — a live, silent cross-device sync failure. Skipping the save entirely when
  // this flag is set removes that failure mode at the source.
  const remoteApplyRef = useRef(false);
  // The ONE way a value that came from storage (load, mirror, poll, realtime)
  // is put into state. Functional so the flag is set only when React will
  // actually re-render: if `next` is the very object already in state (the
  // `[]`/memoised `initial` of a key with no row yet), React bails out, no
  // effect runs, and a flag set unconditionally would still be armed when
  // the user's FIRST real edit arrived — which the save effect would then
  // mistake for a remote apply and never save. That is exactly what happened
  // to the first project created against an empty table.
  const applyRemote = (next) => {
    setValue((cur) => {
      remoteApplyRef.current = !Object.is(cur, next);
      return next;
    });
  };

  // Re-runs whenever `key` changes, not just on mount — this is what lets a
  // single mounted component switch between projects (each with its own
  // storage key) without a full remount. Always sets `value`, even when
  // nothing is stored yet, so switching to a fresh key resets state instead
  // of leaving the previous key's value on screen. `cancelled` guards
  // against a slow Supabase response for an old key landing after a newer
  // key has already been switched to.
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setStatus("loading");

    (async () => {
      if (supabaseEnabled) {
        // Cache-first: show the last-known copy straight away. From here on
        // the hook is "loaded" — an edit made while the real row is still in
        // flight saves normally (array values union-merge in doSave, exactly
        // as they would for an edit made a second later), and the poll's own
        // rule below decides what happens when the row lands: a pending local
        // edit is never overwritten by it.
        let fromMirror = false;
        if (cacheFirst) {
          const cached = readMirror(key);
          if (cached) {
            fromMirror = true;
            applyRemote(cached.value);
            lastSyncedAtRef.current = cached.updatedAt;
            loadedRef.current = true;
            setStatus("syncing");
          }
        }
        // A network failure (offline, DNS, connection reset) REJECTS this
        // promise rather than resolving with an `error` field — without
        // this try/catch that leaves `status` stuck on "loading" forever
        // (and the whole app blank, since App.jsx waits on it) instead of
        // settling on "error".
        try {
          const { data, error } = await supabase.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
          if (cancelled) return;
          if (error) setStatus("error");
          else if (fromMirror && localEditPending()) {
            // A local edit is sitting in the debounce window — it is about to
            // be saved on top of whatever is remote, so applying the fetched
            // row now would just overwrite what is being typed. Same rule as
            // the poll. The save sets the status.
          } else if (fromMirror && data && lastSyncedAtRef.current && data.updated_at <= lastSyncedAtRef.current) {
            // The mirror was already current (or a save landed first): nothing
            // to apply. Deliberately no setValue — a fresh object identity
            // would be indistinguishable from a real edit to the save effect.
            setStatus("saved");
          } else {
            applyRemote(data ? data.value : initial);
            lastSyncedAtRef.current = data ? data.updated_at : null;
            setStatus("saved");
            if (cacheFirst) {
              if (data) writeMirror(key, data.value, data.updated_at);
              else clearMirror(key);                // row gone — never resurrect it
            }
          }
        } catch {
          if (!cancelled) setStatus("error");
        }
      } else if (typeof window === "undefined" || !window.localStorage) {
        setStatus("unavailable");
      } else {
        try {
          const raw = window.localStorage.getItem(key);
          applyRemote(raw ? JSON.parse(raw) : initial);
          setStatus("saved");
        } catch {
          setStatus("error");
        }
      }
      if (!cancelled) loadedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Kept current on every render so a manual saveNow() (see below) always
  // writes the latest value even if it fires between renders.
  const valueRef = useRef(value);
  valueRef.current = value;

  const doSave = async () => {
    saveTimer.current = null;          // the debounce window is over
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    savingRef.current = true;
    let ok = false;
    try {
      ok = await doSaveInner();
    } finally {
      savingRef.current = false;
    }
    if (ok) clearRetry();
    else if (supabaseEnabled) scheduleRetry();   // localStorage failures (quota) won't heal by waiting
  };

  const doSaveInner = async () => {
    if (supabaseEnabled) {
      try {
        let toSave = valueRef.current;
        // Array-shaped values (e.g. the projects index — a plain list of
        // {id, ...} entries) get union-merged by id against whatever is
        // currently in the cloud before this browser overwrites the row.
        // Without this, two accounts creating/renaming projects around the
        // same time would have whichever one saves last silently wipe out
        // the other's concurrent change — neither account is meant to take
        // priority over the other (see CLAUDE.md: same shared data, no
        // per-user separation). Non-array values (a single project's own
        // quote, the rates blob, etc.) keep the simple overwrite — merging
        // arbitrary object edits field-by-field isn't safe to do blindly.
        if (Array.isArray(toSave)) {
          const { data: current } = await supabase.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
          if (current && Array.isArray(current.value) && current.updated_at !== lastSyncedAtRef.current) {
            const byId = new Map();
            current.value.forEach((item) => {
              if (item && item.id != null) byId.set(item.id, item);
            });
            toSave.forEach((item) => {
              if (item && item.id != null) byId.set(item.id, item);
            });
            const merged = Array.from(byId.values());
            if (merged.length !== toSave.length) {
              toSave = merged;
              remoteApplyRef.current = true;
              setValue(merged);
            }
          }
        }
        const nowIso = new Date().toISOString();
        const { error } = await supabase.from(TABLE).upsert({ key, value: toSave, updated_at: nowIso });
        if (!error) {
          lastSyncedAtRef.current = nowIso;
          if (cacheFirst) writeMirror(key, toSave, nowIso);
        }
        setStatus(error ? "error" : "saved");
        return !error;
      } catch {
        setStatus("error");
        return false;
      }
    } else if (typeof window === "undefined" || !window.localStorage) {
      setStatus("unavailable");
      return false;
    } else {
      try {
        window.localStorage.setItem(key, JSON.stringify(valueRef.current));
        setStatus("saved");
        return true;
      } catch {
        setStatus("error");
        return false;
      }
    }
  };

  useEffect(() => {
    if (!loadedRef.current) return;
    if (remoteApplyRef.current) {
      // This change came from the initial load or the poll below, not a local
      // edit — nothing to save, and saving it anyway is what breaks sync (see
      // remoteApplyRef's comment above).
      remoteApplyRef.current = false;
      return;
    }
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 500);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key]);

  // Explicit "Save" button support — bypasses the 500ms debounce and writes
  // immediately, so a click gives instant, visible confirmation rather than
  // trusting the silent auto-save that was already going to happen anyway.
  const saveNow = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus("saving");
    doSave();
  };

  // Closing the tab/navigating away within the 500ms debounce window would
  // otherwise drop whatever was typed last — flush any pending save
  // immediately instead of waiting for the timer. Synchronous for the
  // localStorage path (completes before unload proceeds); best-effort for
  // Supabase, same as the rest of this app's "can't guarantee it, still
  // worth trying" unload-time patterns.
  useEffect(() => {
    const flush = () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      doSave();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polls for a newer value from another device/user roughly every 6s — as close
  // to live as this app gets without a WebSocket subscription. Only ever applies
  // a fetch that's actually newer than what this browser last saved/loaded
  // (never a bare echo of its own last write), and skips entirely while a local
  // edit is still sitting in the debounce window, so a poll landing mid-keystroke
  // can never overwrite what's currently being typed.
  useEffect(() => {
    if (!supabaseEnabled) return;
    const poll = async () => {
      if (localEditPending()) return;
      try {
        const { data, error } = await supabase.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
        if (error || !data) return;
        if (lastSyncedAtRef.current && data.updated_at <= lastSyncedAtRef.current) return;
        lastSyncedAtRef.current = data.updated_at;
        applyRemote(data.value);
        if (cacheFirst) writeMirror(key, data.value, data.updated_at);
      } catch {
        /* best-effort — the next poll tries again */
      }
    };
    const interval = setInterval(poll, 6000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // True push sync: a Postgres change on this row (any device, any account) is
  // pushed to every subscribed browser over Supabase Realtime within about a
  // second, instead of waiting for the next 6s poll. The poll above stays in
  // place as the fallback/safety net — if a realtime event is ever missed
  // (a reconnect gap, a dropped message), the next poll still catches up, so
  // a realtime failure degrades to "as fast as before" rather than breaking
  // sync. Requires the estimator_kv table to be added to the supabase_realtime
  // publication (see supabase/migrations).
  useEffect(() => {
    if (!supabaseEnabled) return;
    const channel = supabase
      .channel(`kv-${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `key=eq.${key}` },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          if (localEditPending()) return;   // our own write is in flight — the poll catches up after
          if (lastSyncedAtRef.current && row.updated_at <= lastSyncedAtRef.current) return;
          lastSyncedAtRef.current = row.updated_at;
          applyRemote(row.value);
          if (cacheFirst) writeMirror(key, row.value, row.updated_at);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Live updates from another browsing context sharing this origin — e.g. the
  // Estimates tool (a separate iframe) writing straight to this project's quote via
  // writeQuote() in lib/projects.js. The native `storage` event only fires in OTHER
  // contexts, never the one that wrote the change, so this never fights with the
  // save effect above. localStorage-only: Supabase-backed state has no equivalent
  // push channel here, so this is a no-op when Supabase is configured.
  useEffect(() => {
    if (supabaseEnabled) return;
    if (typeof window === "undefined") return;
    const onStorage = (e) => {
      if (e.key !== key) return;
      try {
        setValue(e.newValue ? JSON.parse(e.newValue) : initial);
      } catch {
        /* ignore a malformed external write rather than crash */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue, status, saveNow];
}
