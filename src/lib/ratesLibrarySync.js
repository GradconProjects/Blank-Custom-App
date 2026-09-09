/**
 * Rates Library → Quotes price sync.
 *
 * The Rates Library (portal/rates-library.html) is BOMA's authoritative
 * price list. Cost Planner already reads it live and Estimates reads its
 * global block, but Quotes historically kept its own independent copy seeded
 * from data/catalog.js — so editing a price in the library changed nothing on
 * an element card, which is exactly the disagreement that had conventional
 * formwork at $60 in one place and $150 in the other.
 *
 * This closes that gap WITHOUT throwing away deliberate Quotes edits:
 *
 *   - a Quotes rate still equal to its catalog default is unowned → the
 *     library's price is taken;
 *   - a Quotes rate equal to the value this sync last wrote is still owned by
 *     the library → a later library edit flows through too;
 *   - anything else was typed by an estimator in the Rates modal → left
 *     alone. The modal's drift banner shows it and offers a one-click restore.
 *
 * The last-written values live under LIB_SYNC_KEY so the second rule survives
 * a reload. Matching is by product NAME and only where exactly one catalog
 * product carries it — the library's stored shape is {name: {cost}} with no
 * unit, so an ambiguous name is skipped rather than guessed at.
 */
import { FULL_CATALOG } from "../data/catalog.js";
import { rateKey } from "./costing.js";

export const RATES_LIBRARY_KEY = "boma-rates-library";
export const LIB_SYNC_KEY = "boma-rates-libsync";

/* The library sections that hold a plain per-product price. Its other
 * sections (steel build-ups, production hours, PT factors) are inputs to its
 * own calculators, not prices Quotes has a matching product for. */
const PRICED_SECTIONS = ["concreteGrade", "formworkLegacy", "reinfAcc", "otherAcc", "otherAllow"];

const norm = (s) => String(s == null ? "" : s).toLowerCase().trim().replace(/\s+/g, " ");

/** name → the single catalog product with it, or undefined when 0 or 2+ match. */
function catalogByName() {
  const seen = new Map();
  FULL_CATALOG.forEach((cat) => cat.products.forEach((p) => {
    const n = norm(p.name);
    if (seen.has(n)) seen.set(n, null);            // ambiguous — never auto-map
    else seen.set(n, { key: rateKey(cat.key, p.name, p.unit), unitCost: p.unitCost });
  }));
  const out = new Map();
  seen.forEach((v, k) => { if (v) out.set(k, v); });
  return out;
}

/** Every {rateKey, price} the library currently states a price for. */
export function libraryPrices(libraryState) {
  const byName = catalogByName();
  const out = [];
  const seen = new Set();
  if (!libraryState || typeof libraryState !== "object") return out;
  PRICED_SECTIONS.forEach((section) => {
    const rows = libraryState[section];
    if (!rows || typeof rows !== "object") return;
    Object.keys(rows).forEach((name) => {
      const row = rows[name];
      const price = row && typeof row === "object" ? row.cost : row;
      if (typeof price !== "number" || !Number.isFinite(price)) return;
      const hit = byName.get(norm(name));
      if (!hit) return;
      if (seen.has(hit.key)) return;                // the same product priced in two sections: first wins, never flip-flops
      seen.add(hit.key);
      out.push({ key: hit.key, price, catalogCost: hit.unitCost, name, section });
    });
  });
  return out;
}

/* Names the library lists but Quotes must not take a price from: "Delivery
 * fee" appears in TWO library sections ($300 and $0 — different things) and
 * would map to one catalog product, so it is left to the Rates modal. */
export const LIBRARY_EXCLUDED_NAMES = ["Delivery fee"];
const excluded = (name) => LIBRARY_EXCLUDED_NAMES.some((n) => norm(n) === norm(name));

/** The rate keys the library governs right now (a Set). */
export function libraryGovernedKeys(libraryState) {
  const out = new Set();
  libraryPrices(libraryState).forEach(({ key, name }) => { if (!excluded(name)) out.add(key); });
  return out;
}

/**
 * The rate changes this library state implies. THE LIBRARY RULES: for every
 * product it prices, the stored Quotes rate must equal the library price —
 * no matter who set the stored value or on which device. (An earlier rule
 * only moved a rate that still equalled the catalog default or the value the
 * sync last wrote on THIS browser; a second browser, or a value written by an
 * older build, then looked like a deliberate edit and was never corrected —
 * that is how conventional formwork sat at $60 across every project while
 * the library said $150.) Returns [] when nothing should move, so a caller
 * can skip setState entirely and avoid a render loop.
 */
export function pendingRateUpdates(rates, libraryState /* , lastSynced: kept for callers, no longer consulted */) {
  const updates = [];
  libraryPrices(libraryState).forEach(({ key, price, name }) => {
    if (excluded(name)) return;
    const cur = rates && rates[key] ? rates[key].unitCost : undefined;
    if (cur == null) return;                        // not a rate this install carries
    if (Number(cur) === Number(price)) return;      // already agrees
    updates.push({ key, price });
  });
  return updates;
}

/* localStorage helpers — every read is guarded because a private window or a
 * browser with site data blocked throws on access rather than returning null. */
export function readLibraryState() {
  try { return JSON.parse(window.localStorage.getItem(RATES_LIBRARY_KEY)) || null; } catch { return null; }
}
export function readLastSynced() {
  try { return JSON.parse(window.localStorage.getItem(LIB_SYNC_KEY)) || {}; } catch { return {}; }
}
export function writeLastSynced(map) {
  try { window.localStorage.setItem(LIB_SYNC_KEY, JSON.stringify(map)); } catch { /* best-effort */ }
}
