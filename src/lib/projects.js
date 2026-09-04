/**
 * Multi-project index. A project is a lightweight pointer — `{ id,
 * storageKey, createdAt }` — into its own quote object stored separately
 * under `storageKey` (see lib/storage.js, which is backed by Supabase when
 * configured, localStorage otherwise). The index itself lives under
 * PROJECTS_INDEX_KEY. Name/date/GFA/items etc. all live in the quote, not
 * here, so there's exactly one place that owns each piece of data.
 */
import { uid, rateKey } from "./costing.js";
import { supabase, supabaseEnabled } from "./supabaseClient.js";
import { FULL_CATALOG } from "../data/catalog.js";

const TABLE = "estimator_kv";

export const PROJECTS_INDEX_KEY = "boma-projects";
export const LEGACY_QUOTE_KEY = "boma-quote";
export const PUBLISHED_QUOTES_KEY = "boma-published-quotes";

export const quoteStorageKey = (id) => `boma-quote-${id}`;

export function newProjectEntry() {
  const id = uid();
  return { id, storageKey: quoteStorageKey(id), createdAt: new Date().toISOString() };
}

/** Read-only snapshot of one quote, for dashboard summary rows. Not a live
 * subscription — the project editor (via useStoredState) is the source of
 * truth once a project is open. */
export async function readQuote(storageKey) {
  if (supabaseEnabled) {
    try {
      const { data, error } = await supabase.from(TABLE).select("value").eq("key", storageKey).maybeSingle();
      return error || !data ? null : data.value;
    } catch {
      return null;
    }
  }
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Reads many quotes in one round trip — `{ storageKey: quote }` — so the
 * dashboard can summarize every project without one request per row. */
export async function readQuotes(storageKeys) {
  if (storageKeys.length === 0) return {};
  if (supabaseEnabled) {
    try {
      const { data, error } = await supabase.from(TABLE).select("key, value").in("key", storageKeys);
      const map = {};
      if (!error && data) data.forEach((row) => { map[row.key] = row.value; });
      return map;
    } catch {
      return {};
    }
  }
  const map = {};
  storageKeys.forEach((k) => {
    try {
      const raw = window.localStorage.getItem(k);
      if (raw) map[k] = JSON.parse(raw);
    } catch {
      /* skip unreadable entries */
    }
  });
  return map;
}

/** One-time direct write, used only by the Estimates-import flow (see
 * lib/estimateImport.js) to seed a brand-new project's quote before its
 * ProjectEditor (and useStoredState) has ever mounted. Everywhere else,
 * useStoredState owns writes — this bypasses it deliberately because there
 * is no mounted editor yet to own the save. */
export async function writeQuote(storageKey, quote) {
  if (supabaseEnabled) {
    try {
      await supabase.from(TABLE).upsert({ key: storageKey, value: quote, updated_at: new Date().toISOString() });
    } catch {
      /* best-effort */
    }
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(quote));
  } catch {
    /* best-effort */
  }
}

export async function deleteQuote(storageKey) {
  if (supabaseEnabled) {
    try {
      await supabase.from(TABLE).delete().eq("key", storageKey);
    } catch {
      /* best-effort */
    }
    return;
  }
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    /* best-effort */
  }
}

/**
 * Mirrors this project's name/GFA — and every catalog line with a real quantity
 * entered — into "boma-published-quotes", the same shared bridge Estimates
 * already publishes to (see estimates-app.html's writeEstimateExport and
 * cost-planner.html's importPublishedEstimates). Cost Planner matches each line
 * back to its own BOQ catalog by category+product name (the two apps share the
 * same real BOMA ESTIMATES catalog, so this matches cleanly for almost everything —
 * reinforcement, concrete by grade, formwork, rate items, accessories) and drops
 * a new custom BOQ row for anything it can't match, so nothing entered in Quotes
 * is silently missing from Cost Planner's BOQ. Matched back to the same Cost
 * Planner project by this project's own id on every re-publish rather than
 * spawning a duplicate. Best-effort and silent — called from a debounced effect
 * on every real edit, so a failure here should never surface as an error to the
 * estimator working on their quote.
 *
 * Each line also carries the Quotes element's own label (e.g. "RC Columns - Fence
 * Post Columns", "Strip Footings") as its `member` — Cost Planner groups the BOQ
 * report by "building member", and mirroring the exact element the quantity was
 * entered against is a straight 1:1 match to how Quotes itself is organized, rather
 * than remapping through Cost Planner's own coarser member vocabulary (which loses
 * which specific element a line came from, and can group unrelated elements — e.g.
 * two different column types — under one generic "Columns" bucket). Cost Planner's
 * member grouping already accepts any string here, not just its own built-in list.
 */
export async function publishQuoteToCostPlanner(projectId, quote) {
  if (!quote.projectName) return;
  const lines = [];
  (quote.items || []).forEach((item) => {
    const member = item.label || null;
    FULL_CATALOG.forEach((cat) => {
      cat.products.forEach((p) => {
        const qKey = rateKey(cat.key, p.name, p.unit);
        const qty = Number(item.qtys?.[qKey]) || 0;
        if (qty > 0) lines.push({ category: cat.key, name: p.name, unit: p.unit, qty, member });
      });
    });
    (item.additional || []).forEach((a) => {
      const qty = Number(a.qty) || 0;
      if (qty > 0 && a.name) lines.push({ category: "CUSTOM", name: a.name, unit: a.unit || "each", qty, rate: Number(a.rate) || 0, member });
    });
  });
  const record = {
    id: projectId,
    project: {
      name: quote.projectName,
      gfa: Number(quote.gfa) || 0,
      status: quote.status || null,
      deadline: quote.planner?.deadline || null,
      priority: quote.planner?.priority || null,
    },
    lines,
    publishedAt: new Date().toISOString(),
  };
  if (supabaseEnabled) {
    try {
      const { data } = await supabase.from(TABLE).select("value").eq("key", PUBLISHED_QUOTES_KEY).maybeSingle();
      const existing = data && Array.isArray(data.value) ? data.value.slice() : [];
      const idx = existing.findIndex((r) => r && r.id === record.id);
      if (idx >= 0) existing[idx] = record; else existing.push(record);
      await supabase.from(TABLE).upsert({ key: PUBLISHED_QUOTES_KEY, value: existing, updated_at: new Date().toISOString() });
    } catch {
      /* best-effort */
    }
    return;
  }
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(PUBLISHED_QUOTES_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const idx = existing.findIndex((r) => r && r.id === record.id);
    if (idx >= 0) existing[idx] = record; else existing.push(record);
    window.localStorage.setItem(PUBLISHED_QUOTES_KEY, JSON.stringify(existing));
  } catch {
    /* best-effort */
  }
}

/**
 * One-time migration for installs that had a single quote under the old
 * fixed key (`boma-quote`) before multi-project support existed. Turns
 * it into project #1 in the index without moving or duplicating the data —
 * the migrated entry's storageKey stays LEGACY_QUOTE_KEY so nothing is lost
 * if migration runs more than once.
 */
export async function migrateLegacyQuote() {
  const legacy = await readQuote(LEGACY_QUOTE_KEY);
  if (!legacy) return [];
  return [{ id: "legacy", storageKey: LEGACY_QUOTE_KEY, createdAt: legacy.projectDate || new Date().toISOString() }];
}
