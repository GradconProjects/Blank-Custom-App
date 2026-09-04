import { useState, useEffect, useRef } from "react";
import { supabase, supabaseEnabled } from "./supabaseClient.js";

const TABLE = "estimator_kv";

/**
 * Persists React state under `key`, debounced so rapid typing doesn't
 * hammer storage. Returns [value, setValue, status] where status is one
 * of: "loading" | "saved" | "saving" | "error" | "unavailable".
 *
 * Backed by Supabase (shared across every browser/device — see
 * lib/supabaseClient.js) when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 * configured; otherwise falls back to per-browser localStorage, so the app
 * still works with no Supabase project set up. Every caller gets the same
 * [value, setValue, status] shape regardless of which backend is active —
 * that's deliberate (see CLAUDE.md → "Known limitations") so components
 * never need to know or care which one is in use.
 */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState("loading");
  const loadedRef = useRef(false);
  const saveTimer = useRef(null);
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
        // A network failure (offline, DNS, connection reset) REJECTS this
        // promise rather than resolving with an `error` field — without
        // this try/catch that leaves `status` stuck on "loading" forever
        // (and the whole app blank, since App.jsx waits on it) instead of
        // settling on "error".
        try {
          const { data, error } = await supabase.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
          if (cancelled) return;
          if (error) setStatus("error");
          else {
            remoteApplyRef.current = true;
            setValue(data ? data.value : initial);
            lastSyncedAtRef.current = data ? data.updated_at : null;
            setStatus("saved");
          }
        } catch {
          if (!cancelled) setStatus("error");
        }
      } else if (typeof window === "undefined" || !window.localStorage) {
        setStatus("unavailable");
      } else {
        try {
          const raw = window.localStorage.getItem(key);
          remoteApplyRef.current = true;
          setValue(raw ? JSON.parse(raw) : initial);
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
        if (!error) lastSyncedAtRef.current = nowIso;
        setStatus(error ? "error" : "saved");
      } catch {
        setStatus("error");
      }
    } else if (typeof window === "undefined" || !window.localStorage) {
      setStatus("unavailable");
    } else {
      try {
        window.localStorage.setItem(key, JSON.stringify(valueRef.current));
        setStatus("saved");
      } catch {
        setStatus("error");
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
      if (saveTimer.current) return;
      try {
        const { data, error } = await supabase.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
        if (error || !data) return;
        if (lastSyncedAtRef.current && data.updated_at <= lastSyncedAtRef.current) return;
        lastSyncedAtRef.current = data.updated_at;
        remoteApplyRef.current = true;
        setValue(data.value);
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
          if (lastSyncedAtRef.current && row.updated_at <= lastSyncedAtRef.current) return;
          lastSyncedAtRef.current = row.updated_at;
          remoteApplyRef.current = true;
          setValue(row.value);
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
