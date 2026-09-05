/**
 * Costing engine. Pure functions only — no React, no DOM, no storage.
 * Import this directly in Node (see scripts/verify.mjs) to sanity-check
 * the maths after any change, without spinning up a browser.
 *
 * Read CLAUDE.md → "Costing rules" before editing computeElementCost.
 */
import { FULL_CATALOG, RESOURCE_COLS, LABOUR_TEMPLATES, GST_RATE, PRODUCTION_RATES, DEFAULT_MARGIN, MARGIN_STEPS, MIN_CARTAGE_THRESHOLD_M3, TRUCK_LOAD_M3 } from "../data/catalog.js";

// Shared with portal-shell.html's Settings modal (same localStorage key, same
// origin — the portal embeds this app via a blob: URL created from its own
// page, which inherits that page's origin) — lets a user preference set
// outside this app's own React tree still reach these plain formatter
// functions, which are called all over the component tree via a simple
// import rather than a hook.
function readPrefs() {
  try {
    const raw = localStorage.getItem("boma-preferences");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const money = (n) =>
  (n || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

export const money2 = (n) => {
  const p = readPrefs();
  const dp = Number.isFinite(p.moneyDecimals) ? p.moneyDecimals : 2;
  return (n || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: dp, maximumFractionDigits: dp });
};

/** GST rate as a fraction — the Settings preference (entered as a whole %,
 * e.g. 10) overrides the catalog's GST_RATE; absent/invalid falls back. */
export function getGstRate() {
  const p = readPrefs();
  return Number.isFinite(p.gstRatePct) ? p.gstRatePct / 100 : GST_RATE;
}

/** Default margin as a fraction — Settings preference (whole %, e.g. 30)
 * over the catalog's DEFAULT_MARGIN. Bounded to <95% so the margin ladder's
 * divide-by-(1-margin) can never blow up on a bad saved value. */
export function getDefaultMargin() {
  const p = readPrefs();
  if (Number.isFinite(p.defaultMarginPct) && p.defaultMarginPct >= 0 && p.defaultMarginPct < 95) {
    return p.defaultMarginPct / 100;
  }
  return DEFAULT_MARGIN;
}

/** MARGIN_STEPS with the (possibly customised) default margin merged in,
 * sorted — so the ladder always contains a row for the default margin and
 * the Dashboard/QuoteSummary "default" highlight always has a row to hit. */
export function getMarginSteps() {
  const def = getDefaultMargin();
  const steps = MARGIN_STEPS.includes(def) ? MARGIN_STEPS : [...MARGIN_STEPS, def];
  return [...steps].sort((a, b) => a - b);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Key used both to look up a rate and to store a quantity against a product. */
export const rateKey = (cat, name, unit) => `${cat}::${name}::${unit}`;

/**
 * Builds the default rates object (every catalog product + every labour
 * resource) from src/data/catalog.js. This is the seed for a fresh
 * install; a user's live edits in the Rates panel are persisted
 * separately (see lib/storage.js) and layered on top.
 */
export function defaultRates() {
  const r = {};
  FULL_CATALOG.forEach((cat) => {
    cat.products.forEach((p) => {
      r[rateKey(cat.key, p.name, p.unit)] = { unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength, minQty: p.minQty };
    });
  });
  RESOURCE_COLS.forEach((res) => {
    r[rateKey("LABOUR", res.name, res.unit)] = { unitCost: res.rate, unitWeight: null };
  });
  PRODUCTION_RATES.forEach((pr) => {
    r[rateKey("PRODUCTION", pr.name, pr.unit)] = { unitCost: pr.rate, unitWeight: null };
  });
  return r;
}

/**
 * A rate lookup that ALWAYS falls back to the catalog's own default if the
 * key is missing from `rates` (e.g. a saved rates object from before the
 * catalog was extended). Never let a missing key render as blank/undefined
 * pricing — use this helper (or the same fallback pattern) anywhere a rate
 * is read, rather than indexing into `rates` directly.
 */
export function lookupRate(rates, key, fallback) {
  return rates[key] || fallback;
}

/**
 * The ONE place that turns a catalog row's quantity into a dollar figure —
 * computeElementCost, CategoryBlock.jsx and PrintQuoteReport.jsx all call
 * this rather than recomputing it themselves, so the three can never
 * silently disagree. See CLAUDE.md "Costing rules" and the areaBasis/
 * weightBasis comment above FULL_CATALOG in data/catalog.js.
 */
export function computeRowTotal(cat, rate, qty) {
  // Contract MINIMUMS (a "4 hour min" pump bills 4 hours for a 1-hour job).
  // Applied first so every basis below prices the billed quantity, and only
  // to a row that has a quantity — a blank row still costs nothing.
  if (qty > 0 && rate.minQty > 0 && qty < rate.minQty) qty = rate.minQty;
  if (cat.weightBasis && rate.unitWeight) {
    return ((qty * rate.unitWeight) / 1000) * rate.unitCost;
  }
  if (cat.areaBasis && rate.sheetArea) {
    return Math.ceil(qty / rate.sheetArea) * rate.unitCost;
  }
  if (cat.lengthBasis && rate.barLength) {
    return Math.ceil(qty / rate.barLength) * rate.unitCost;
  }
  return qty * rate.unitCost;
}

const MIN_CARTAGE_PRODUCT_MATCH = /minimum cartage|small load/i;   // legacy name still matches
// Per-m³ fees charged on EVERY delivered m³, with no threshold.
const SURCHARGE_PRODUCT_MATCH = /transport surcharge/i;
const LEVY_PRODUCT_MATCH = /environment levy/i;
/** Rows that are FEES on the concrete rather than concrete itself — never
 * counted as poured volume, and never charged on each other. */
const CONCRETE_CHARGE_MATCH = (name) =>
  MIN_CARTAGE_PRODUCT_MATCH.test(name) || SURCHARGE_PRODUCT_MATCH.test(name) ||
  LEVY_PRODUCT_MATCH.test(name);
/** …plus additives, whose m³ mirrors the mix and would double-count volume. */
const CONCRETE_FEE_MATCH = (name) => CONCRETE_CHARGE_MATCH(name) || /additive/i.test(name);

/** The element's real poured volume: concrete mixes and blinding, with the
 * fee rows and additives (whose m³ mirrors the mix) excluded. */
function pouredVolume(item) {
  const cat = FULL_CATALOG.find((c) => c.key === "CONCRETE");
  let vol = 0;
  cat.products.forEach((p) => {
    if (CONCRETE_FEE_MATCH(p.name)) return;
    vol += Number(item.qtys[rateKey(cat.key, p.name, p.unit)]) || 0;
  });
  return vol;
}

/**
 * Holcim MINIMUM CARTAGE, applied automatically. The fee is charged where a
 * DELIVERED LOAD is under MIN_CARTAGE_THRESHOLD_M3 (4 m³), on the
 * undelivered part of that load — (4 − load) × $80/m³ — per truck, NOT on
 * the order total. A quote holds a total volume rather than a delivery
 * schedule, so the volume is split into whole truck loads (the editable
 * "Concrete truck load size" production rate, 8 m³ by default) and the
 * shortfall is charged on the last, part load: 11 m³ delivered 8+3 is 1 m³
 * short, so $80. A pour that divides evenly, or whose last load already
 * reaches 4 m³, attracts nothing.
 *
 * Typing anything into the Minimum cartage row's Qty takes the row fully
 * manual — that's how a known delivery split (7+4, say) is priced exactly.
 * Returns { key, qty (m³ short), unitCost ($/m³ short), total, loads,
 * lastLoad } or null.
 */
export function autoMinimumCartage(item, rates) {
  const cat = FULL_CATALOG.find((c) => c.key === "CONCRETE");
  const mc = cat && cat.products.find((p) => MIN_CARTAGE_PRODUCT_MATCH.test(p.name));
  if (!mc) return null;
  const key = rateKey(cat.key, mc.name, mc.unit);
  const typed = item.qtys[key];
  if (typed !== undefined && typed !== "") return null; // the estimator's own entry wins
  const vol = pouredVolume(item);
  if (!(vol > 0)) return null;
  const capacity = prodRate(rates, "Concrete truck load size", "m³/load", TRUCK_LOAD_M3);
  if (!(capacity > 0)) return null;
  const loads = Math.ceil(vol / capacity - 1e-9);
  const lastLoad = vol - (loads - 1) * capacity;
  const short = round2(Math.max(0, MIN_CARTAGE_THRESHOLD_M3 - lastLoad));
  if (!(short > 0)) return null;
  const rate = lookupRate(rates, key, { unitCost: mc.unitCost ?? 0 });
  return { key, qty: short, unitCost: rate.unitCost ?? 0, total: short * (rate.unitCost ?? 0), loads, lastLoad: round2(lastLoad) };
}
/** Kept so older imports keep working. */
export const autoSmallLoadCharge = autoMinimumCartage;

/** A per-m³ concrete fee charged on the WHOLE poured volume with no
 * threshold (the production & transport surcharge and the environment
 * levy both work this way). A typed Qty on the row takes it fully manual. */
function autoConcreteFee(item, rates, match) {
  const cat = FULL_CATALOG.find((c) => c.key === "CONCRETE");
  const fee = cat && cat.products.find((p) => match.test(p.name));
  if (!fee) return null;
  const key = rateKey(cat.key, fee.name, fee.unit);
  const typed = item.qtys[key];
  if (typed !== undefined && typed !== "") return null;
  const vol = pouredVolume(item);
  if (!(vol > 0)) return null;
  const rate = lookupRate(rates, key, { unitCost: fee.unitCost ?? 0 });
  return { key, qty: vol, unitCost: rate.unitCost ?? 0, total: vol * (rate.unitCost ?? 0) };
}
/** Holcim production & transport surcharge — $/m³ on every delivered m³. */
export function autoConcreteSurcharge(item, rates) {
  return autoConcreteFee(item, rates, SURCHARGE_PRODUCT_MATCH);
}
/** Holcim environment levy — $/m³ on every delivered m³. */
export function autoEnvironmentLevy(item, rates) {
  return autoConcreteFee(item, rates, LEVY_PRODUCT_MATCH);
}

/** Creates a fresh quote line item for the given element type. */
const REO_RATE_PRODUCT_MATCH = /reinforcement by rate/i;

/**
 * REINFORCEMENT BY RATE — kg of steel per m³ of concrete.
 *
 * Early in a job nobody has a bar schedule, but everyone has a rule of thumb:
 * a suspended slab runs ~90 kg/m³, columns ~150. This lets an estimator set
 * that rate on the element (`item.reoRatePerM3`) and have the tonnage fall
 * out of the volume already entered, instead of taking off bars they don't
 * have drawings for yet.
 *
 * It is OFF unless the element carries a rate — no rate, no row, no cost. A
 * default rate here would silently add reinforcement to every existing quote,
 * which is precisely the kind of quiet wrong number the rules in CLAUDE.md
 * exist to prevent.
 *
 * Same manual-override contract as the concrete delivery fees: typing a Qty
 * on the "Reinforcement by rate" row takes that row fully manual (the
 * estimator has a real tonnage and wants it billed exactly), and this returns
 * null so the ordinary computeRowTotal path prices it instead.
 *
 * Volume is pouredVolume(item) — the same figure the delivery fees use, so
 * additives and the fee rows never inflate it.
 *
 * Returns { key, ratePerM3, volume, tonnes, unitCost, total } or null.
 */
export function autoReinforcementByRate(item, rates) {
  const ratePerM3 = Number(item.reoRatePerM3) || 0;
  if (ratePerM3 <= 0) return null;

  const cat = FULL_CATALOG.find((c) => c.key === "PROCESSED BAR");
  const product = cat && cat.products.find((p) => REO_RATE_PRODUCT_MATCH.test(p.name));
  if (!product) return null;

  const key = rateKey(cat.key, product.name, product.unit);
  if ((Number(item.qtys[key]) || 0) > 0) return null; // typed = manual

  const volume = pouredVolume(item);
  if (volume <= 0) return null;

  const rate = lookupRate(rates, key, { unitCost: product.unitCost ?? 0 });
  const tonnes = (volume * ratePerM3) / 1000;
  return { key, ratePerM3, volume, tonnes, unitCost: rate.unitCost, total: tonnes * rate.unitCost };
}

export function newElementItem(type) {
  return {
    id: uid(),
    typeId: type.id,
    category: type.category,
    section: type.section,
    label: type.name,
    collapsed: false,
    description: "", // free-text spec notes ("R2.5 XPS insulation under slab", etc.)
    markups: [], // [{id, name, type, dataURL}] — uploaded markup drawings (pdf/png/jpg)
    labourAuto: true, // crew days auto-derived from quantities (rate-of-work); typed cells override
    labourVer: 2, // crew-engine era marker — elements without it get their labour cells cleared once (see ElementCard), so values baked in by the old write-in prefill can't shadow the live engine
    qtys: {}, // rateKey(category, product, unit) -> number
    tasks: LABOUR_TEMPLATES[type.labour].map((name) => ({ id: uid(), name, qtys: {} })), // qtys: resourceKey -> number
    additional: [], // [{id, name, unit, qty, rate}]
  };
}

/**
 * Computes every cost figure for one quote line item.
 *
 * Costing rules (see CLAUDE.md for the full explanation):
 *  - Every category in FULL_CATALOG is walked; a product only contributes
 *    if its quantity is > 0. Blank rows are free — that's what lets every
 *    tab show the WHOLE catalog without inflating totals.
 *  - weightBasis categories (currently only PROCESSED BAR) cost as
 *    (qty * unitWeight / 1000) * unitCost  — i.e. Total Weight (tonnes) *
 *    $/tonne.
 *  - areaBasis categories (currently only SQUARE MESH) cost as
 *    ceil(qty / sheetArea) * unitCost — qty is m² of coverage, sheets are
 *    bought whole so the count always rounds up.
 *  - lengthBasis categories (currently only STOCK BAR) cost as
 *    ceil(qty / barLength) * unitCost — qty is metres of bar needed, bars
 *    are bought whole (fixed stock lengths) so the count always rounds up.
 *  - All other categories cost as qty * unitCost directly, even if the
 *    product also carries a unitWeight (Trench Mesh shows tonnage for
 *    information only — do not switch it to weight-based costing, its
 *    catalog price is per length). See computeRowTotal, the single
 *    implementation of all four rules above.
 *  - Labour: for each task row, quantities are entered per resource
 *    (day-count or hour-count). Resource totals are summed across all task
 *    rows, then each resource total is multiplied by that resource's
 *    day/hour rate. The element's labour total is the sum of all resource
 *    costs.
 *  - `total` = materialsTotal + labourTotal + additionalTotal. Nothing
 *    else feeds into an element's total cost.
 */
export function computeElementCost(item, rates) {
  const categoryTotals = {};
  let materialsTotal = 0;
  let concreteQty = 0;

  FULL_CATALOG.forEach((cat) => {
    let catTotal = 0;
    cat.products.forEach((p) => {
      const qKey = rateKey(cat.key, p.name, p.unit);
      const qty = Number(item.qtys[qKey]) || 0;
      if (qty > 0) {
        const rate = lookupRate(rates, qKey, { unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea });
        const rowTotal = computeRowTotal(cat, rate, qty);
        catTotal += rowTotal;
        if (cat.key === "CONCRETE" && !CONCRETE_CHARGE_MATCH(p.name)) concreteQty += qty; // the delivery fees are $/m³ charges, not poured volume
      }
    });
    categoryTotals[cat.key] = catTotal;
    materialsTotal += catTotal;
  });

  // Holcim service fees, applied automatically to the poured volume:
  // minimum cartage on a last load under 4 m³, then the per-m³ production &
  // transport surcharge and environment levy. None of them count as poured
  // volume (concreteQty), and a typed Qty on any of their rows takes that
  // row manual — see the auto* functions above.
  [autoMinimumCartage(item, rates), autoConcreteSurcharge(item, rates), autoEnvironmentLevy(item, rates)]
    .forEach((fee) => {
      if (!fee) return;
      categoryTotals["CONCRETE"] = (categoryTotals["CONCRETE"] || 0) + fee.total;
      materialsTotal += fee.total;
    });

  // Reinforcement priced off a kg/m³ rate rather than a bar schedule. Same
  // shape as the fees above — dormant unless the element carries a rate, and
  // stood down the moment a Qty is typed on its row.
  const reoByRate = autoReinforcementByRate(item, rates);
  if (reoByRate) {
    categoryTotals["PROCESSED BAR"] = (categoryTotals["PROCESSED BAR"] || 0) + reoByRate.total;
    materialsTotal += reoByRate.total;
  }

  // Seamless labour: with labourAuto on, empty matrix cells are driven live
  // by the rate-of-work engine (autoLabourQtys) — quantities entered above
  // flow straight into crew days at the rates-library production rates. A
  // typed cell always wins; nothing is ever written back into the tasks.
  // Crew columns price PER PERSON per day; each ROW carries its own
  // per-crew / per-person toggle and its own men-per-crew (taskCrewMen):
  // a per-crew row's cells are crew-days costed as cells × men × man-day
  // rate, a per-person row's cells are man-days costed directly. Plant
  // columns ignore the toggle. resourceTotals stays the raw cell sum for
  // display; the weighting only enters the cost.
  const autoQtys = item.labourAuto !== false ? autoLabourQtys(item, rates) : null;
  const resourceTotals = {};
  const resourceManDays = {};
  RESOURCE_COLS.forEach((res) => { resourceTotals[res.key] = 0; resourceManDays[res.key] = 0; });
  item.tasks.forEach((task) => {
    RESOURCE_COLS.forEach((res) => {
      const manual = task.qtys[res.key];
      const eff = manual !== undefined && manual !== "" ? Number(manual) || 0
        : (autoQtys && autoQtys[task.id] && autoQtys[task.id][res.key]) || 0;
      // Crew columns keep their decimals (0.5 crew-days is half a day's
      // crew, not a booked whole crew — the whole-crew rounding is gone);
      // plant days/hours still book whole, pump m³ is a measured volume.
      const cell = res.crew || res.key === "pump_m3" ? eff : Math.ceil(eff - 1e-9);
      resourceTotals[res.key] += cell;
      resourceManDays[res.key] += cell * taskCrewMen(task, res);
    });
  });

  let labourTotal = 0;
  const resourceCosts = {};
  RESOURCE_COLS.forEach((res) => {
    const rate = labourResourceRate(rates, res);
    const cost = resourceManDays[res.key] * rate;
    resourceCosts[res.key] = cost;
    labourTotal += cost;
  });

  const additionalTotal = item.additional.reduce(
    (s, a) => s + (Number(a.qty) || 0) * (Number(a.rate) || 0),
    0
  );

  return {
    categoryTotals,
    materialsTotal,
    resourceTotals,
    resourceCosts,
    labourTotal,
    additionalTotal,
    concreteQty,
    total: materialsTotal + labourTotal + additionalTotal,
  };
}

/**
 * Total reinforcement weight (tonnes) across every weight-carrying category
 * in one element — mirrors CategoryBlock.jsx's per-row "Total (t)" column,
 * summed across the whole element. Used by suggestedLabourPrefill to size
 * steel-fixing hours; kept separate from computeElementCost's own totals
 * (which only ever COST Processed Bar by weight — see CLAUDE.md rule 2).
 */
/**
 * The reinforcement categories, and ONLY these. This used to be "any product
 * carrying a unitWeight", which was true right up until structural steel
 * arrived — every UB, SHS and purlin carries a kg/m too, and they were
 * silently counted as reinforcement, booking steel-FIXING crew days for
 * steel that gets erected by a crane. A whitelist can't drift that way.
 */
const REINFORCEMENT_CATEGORIES = new Set([
  "TRENCH MESH", "SQUARE MESH", "STOCK BAR", "PROCESSED BAR",
]);

export function computeElementReinforcementTonnes(item, rates) {
  let totalKg = 0;
  FULL_CATALOG.forEach((cat) => {
    if (!REINFORCEMENT_CATEGORIES.has(cat.key)) return;
    cat.products.forEach((p) => {
      if (p.unitWeight == null) return;
      const qKey = rateKey(cat.key, p.name, p.unit);
      const qty = Number(item.qtys[qKey]) || 0;
      if (qty <= 0) return;
      const rate = lookupRate(rates, qKey, { unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength });
      if (rate.unitWeight == null) return;
      const sheets = cat.areaBasis && rate.sheetArea ? Math.ceil(qty / rate.sheetArea) : null;
      const bars = cat.lengthBasis && rate.barLength ? Math.ceil(qty / rate.barLength) : null;
      const units = sheets != null ? sheets : bars != null ? bars : qty;
      totalKg += units * rate.unitWeight;
    });
  });
  // Rate-based reinforcement has no unitWeight for the loop above to scan —
  // its Qty is already tonnes — so it's added here instead. Both routes
  // count: the auto rate, and a tonnage typed straight onto the row. Without
  // this a rate-priced element would report zero steel and earn no
  // steel-fixing crew days.
  const reoCat = FULL_CATALOG.find((c) => c.key === "PROCESSED BAR");
  const reoProduct = reoCat && reoCat.products.find((p) => REO_RATE_PRODUCT_MATCH.test(p.name));
  if (reoProduct) {
    const typed = Number(item.qtys[rateKey(reoCat.key, reoProduct.name, reoProduct.unit)]) || 0;
    if (typed > 0) totalKg += typed * 1000;
  }
  const byRate = autoReinforcementByRate(item, rates);
  if (byRate) totalKg += byRate.tonnes * 1000;
  return totalKg / 1000;
}

const CONCRETE_POUR_TASK_MATCH = /pour/i;                     // "Pour / place / vibrate concrete", legacy "Pour concrete (pump)"
const STEEL_FIXING_TASK_MATCH = /tie (steel|reinforcement)/i; // "Tie reinforcement", legacy "Tie steel"
const FINISH_TASK_MATCH = /finish concrete/i;                 // "Finish concrete surfaces"
const EXCAVATE_TASK_MATCH = /excavate/i;                      // "Excavate & prepare base"
const FORMWORK_TASK_MATCH = /formwork|box out|prop & form/i;  // legacy per-type templates only
const STRIP_TASK_MATCH = /^strip/i;
const GENERAL_TASK_MATCH = /washout|tidy|clean|patch/i;       // "Washout / clean / tidy"
// The steel erection sequence (LABOUR_TEMPLATES.steel). "Erect steel frame"
// is driven by tonnage, sheeting by area; bolt-up, welding and the rest are
// too piece-count dependent to derive and stay manual, like formwork.
/** Categories whose Qty is metres of section priced $/tonne — their tonnage
 *  is what the erection crew stands. */
const STEEL_SECTION_CATEGORY = /^STEEL SECTIONS/;
/** Fabricated assemblies already quoted by the tonne. */
const STEEL_FABRICATED_CATEGORY = /^STEEL FRAMING/;
const STEEL_ERECT_TASK_MATCH = /erect steel/i;
const STEEL_SHEET_TASK_MATCH = /roof & wall sheeting/i;

/** The quantities each crew-sheet row draws on, read DIRECTLY from the
 * element's entered line items: concrete m³ from the CONCRETE rows, formwork
 * m² from the FORMWORK rows, finish m² from the mesh coverage entered
 * (mesh area ≈ finished slab surface). Pure qty scan — no costing — so the
 * labour engine can run inside computeElementCost without recursion. */
export function labourQuantities(item, rates) {
  let concreteM3 = 0, formworkM2 = 0, finishM2 = 0, excavationM3 = 0;
  let steelTonnes = 0, claddingM2 = 0;
  FULL_CATALOG.forEach((cat) => {
    const steelSection = cat.weightBasis && STEEL_SECTION_CATEGORY.test(cat.key);
    const steelFabricated = STEEL_FABRICATED_CATEGORY.test(cat.key);
    const cladding = cat.key === "ROOF & WALL CLADDING";
    if (!steelSection && !steelFabricated && !cladding &&
        cat.key !== "CONCRETE" && cat.key !== "FORMWORK" && cat.key !== "SQUARE MESH" && cat.key !== "OTHER ALLOWANCES") return;
    cat.products.forEach((p) => {
      const qKey = rateKey(cat.key, p.name, p.unit);
      const qty = Number(item.qtys[qKey]) || 0;
      if (qty <= 0) return;
      if (steelSection) {
        // weightBasis: Qty is metres, so tonnage needs the section's kg/m —
        // the rate, not the catalog, so a Rates-modal override is honoured.
        const rate = lookupRate(rates, qKey, { unitWeight: p.unitWeight });
        steelTonnes += (qty * (rate.unitWeight || 0)) / 1000;
      } else if (steelFabricated) {
        // These are already quoted in tonnes of finished frame; the per-item
        // and per-metre lines in the same category aren't erection tonnage.
        if (p.unit === "t") steelTonnes += qty;
      } else if (cladding) {
        if (p.unit === "m2") claddingM2 += qty;
      } else if (cat.key === "CONCRETE" && !SURCHARGE_PRODUCT_MATCH.test(p.name)) concreteM3 += qty; // the surcharge row is a fee, not poured volume
      else if (cat.key === "FORMWORK" && p.unit === "m2") formworkM2 += qty;
      else if (cat.key === "SQUARE MESH") finishM2 += qty;
      else if (cat.key === "OTHER ALLOWANCES" && /soil removal/i.test(p.name)) excavationM3 += qty; // spoil volume ≈ excavation m³
    });
  });
  return {
    concreteM3, formworkM2, finishM2, excavationM3,
    steelTonnes: round2(steelTonnes), claddingM2,
    reinfTonnes: computeElementReinforcementTonnes(item, rates),
  };
}

/**
 * Benchmark unit rates for one element — the "$/lm · $/m² · $/m³" summary
 * shown beside its row. Each is the element's WHOLE cost (materials +
 * labour/plant + custom items) over one measure, so a strip footing's $/lm
 * is genuinely everything that footing costs divided by the total length of
 * the strips.
 *
 * The two measures a price list can't imply — the total run and the
 * plan/footprint area — are measured in the Estimates app's Project
 * Geometry table and travel here on publish (item.measureLm /
 * item.measureM2, see lib/estimateImport.js). The third, m³, is the
 * element's own poured concrete volume, so it never needs recording.
 *
 * There is deliberately NO per-element-type logic here: a line appears if
 * and only if its measure exists, in the fixed order lm → m² → m³. An
 * element with no recorded geometry and no concrete simply has no rates.
 */
export function computeElementUnitRates(item, rates) {
  const { total, concreteQty } = computeElementCost(item, rates);
  if (total <= 0) return [];
  const measures = [
    ["lm", Number(item.measureLm) || 0],
    ["m²", Number(item.measureM2) || 0],
    ["m³", concreteQty],
  ];
  return measures
    .filter(([, qty]) => qty > 0)
    .map(([unit, qty]) => ({ unit, qty: round2(qty), rate: total / qty }));
}

/**
 * The same benchmark rates for the WHOLE project: every element's cost over
 * the project's total run, area and poured concrete. Same shape and same
 * fixed lm -> m² -> m³ order as computeElementUnitRates, so the Project
 * Geometry header can print the project's $/lm, $/m² and $/m³ beside its
 * measured totals.
 */
export function computeProjectUnitRates(items, rates) {
  let cost = 0, lm = 0, m2 = 0, m3 = 0;
  (items || []).forEach((item) => {
    const c = computeElementCost(item, rates);
    cost += c.total;
    m3 += c.concreteQty;
    lm += Number(item.measureLm) || 0;
    m2 += Number(item.measureM2) || 0;
  });
  if (cost <= 0) return [];
  return [["lm", lm], ["m²", m2], ["m³", m3]]
    .filter(([, qty]) => qty > 0)
    .map(([unit, qty]) => ({ unit, qty: round2(qty), rate: cost / qty }));
}

/** Crew-sheet row metadata: the unit each task is measured in and which
 * element quantity fills its Qty column automatically. Excavation draws its
 * volume from the element's "Soil removal" (m³) line. */
export function taskRowMeta(taskName, lq) {
  if (CONCRETE_POUR_TASK_MATCH.test(taskName)) return { unit: "m³", autoQty: lq ? lq.concreteM3 : undefined };
  if (STEEL_FIXING_TASK_MATCH.test(taskName)) return { unit: "t", autoQty: lq ? round2(lq.reinfTonnes) : undefined };
  if (FINISH_TASK_MATCH.test(taskName)) return { unit: "m²", autoQty: lq ? lq.finishM2 : undefined };
  if (STEEL_ERECT_TASK_MATCH.test(taskName)) return { unit: "t", autoQty: lq ? lq.steelTonnes : undefined };
  if (STEEL_SHEET_TASK_MATCH.test(taskName)) return { unit: "m²", autoQty: lq ? lq.claddingM2 : undefined };
  if (EXCAVATE_TASK_MATCH.test(taskName)) return { unit: "m³", autoQty: lq ? lq.excavationM3 : undefined };
  if (FORMWORK_TASK_MATCH.test(taskName) && !STRIP_TASK_MATCH.test(taskName)) return { unit: "m²", autoQty: lq ? lq.formworkM2 : undefined };
  return { unit: "", autoQty: undefined };
}

const prodRate = (rates, name, unit, fallback) =>
  lookupRate(rates, rateKey("PRODUCTION", name, unit), { unitCost: fallback }).unitCost;
const round2 = (v) => Math.round(v * 100) / 100;

/** Labour rate for a resource column — always the rate saved in the rates
 * library, falling back to the catalog default (CLAUDE.md rule 6). Crew
 * columns price PER PERSON per day under a "man-day" unit key — deliberately
 * different from both the original per-person "day" keys and the crew-era
 * "crew-day" keys, so neither generation of stale overrides applies. */
export function labourResourceRate(rates, res) {
  return lookupRate(rates, rateKey("LABOUR", res.name, res.unit), { unitCost: res.rate }).unitCost;
}

/** Which mode a crew-sheet row is in: "person" (cells are man-days — the
 * default, until the estimator switches the row) or "crew" (cells are
 * crew-days × that row's own men-per-crew). */
export const taskCrewMode = (task) => (task && task.crewMode === "crew" ? "crew" : "person");

/** The per-person multiplier a row's cells carry in a given column: a
 * per-crew row on a crew column multiplies by that row's own men-per-crew
 * (its crewSize, blank → the column's catalog default `men`); a per-person
 * row, and every plant column, multiplies by 1. */
export function taskCrewMen(task, res) {
  if (!res.crew || taskCrewMode(task) === "person") return 1;
  const n = Number(task && task.crewSize);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : res.men || 1;
}

/**
 * The seamless labour engine — one row per crew-sheet task. Each row's Qty
 * draws DIRECTLY from the element's entered line items (concrete m³,
 * reinforcement t, finish m²); crew-days follow as
 *
 *   crew-days = qty / block   (decimals kept — 36 m³ at 10 m³/day is 3.6)
 *
 * where `block` is how much ONE crew-day covers (rates library
 * PRODUCTION_RATES). Each ROW carries its own per-crew / per-person toggle
 * and men-per-crew (see taskCrewMen): a per-person row's suggestions are
 * converted to man-days (crews × men). Pump m³ stays the real measured
 * volume (priced per m³ pumped), and pump hours book a flat whole-pour
 * booking (6 hrs) whenever concrete is poured.
 *
 * Typing into a row's Qty cell overrides what that row draws on; typing
 * into a crew cell overrides the derived crew-days outright. Returns
 * {taskId: {resourceKey: qty}} covering only cells the estimator hasn't
 * filled — nothing is ever written back into the tasks.
 */
export function autoLabourQtys(item, rates) {
  const lq = labourQuantities(item, rates);
  const pourM3Block = prodRate(rates, "Concrete pour — m³ per crew-day", "m³/day", 10);
  const steelTBlock = prodRate(rates, "Rebar fixing — tonnes per crew-day", "t/day", 1);
  const finishM2Block = prodRate(rates, "Surface finishing — m² per crew-day", "m²/day", 300);
  const generalM3Block = prodRate(rates, "General labour — m³ per crew-day", "m³/day", 60);
  const pumpHrsPour = prodRate(rates, "Concrete pump — hours per pour", "hrs", 6);
  const erectTBlock = prodRate(rates, "Steel erection — tonnes per crew-day", "t/day", 4);

  // qty → crew-days, decimals kept: 36 m³ at 10 m³/crew-day is 3.6
  // crew-days, 2.99 t of steel is 2.99 — the old whole-crew rounding
  // (ceil + minimum one crew) is gone; the estimator rounds if they want.
  const crewDays = (qty, block) =>
    qty > 0 ? round2(qty / Math.max(block, 1e-9)) : 0;

  const hasFinishTask = (item.tasks || []).some((t) => FINISH_TASK_MATCH.test(t.name));
  const colByKey = {};
  RESOURCE_COLS.forEach((r) => { colByKey[r.key] = r; });
  const suggestions = {};
  const put = (task, key, qty) => {
    if (qty <= 0) return;
    if (task.qtys[key] !== undefined && task.qtys[key] !== "") return; // typed cells win
    // a per-person row (the default) shows man-days: the same crew booking
    // expressed as crews × that row's men (crewSize, blank → column default)
    const res = colByKey[key];
    if (res && res.crew && taskCrewMode(task) === "person") {
      const n = Number(task.crewSize);
      qty = round2(qty * (Number.isFinite(n) && n >= 1 ? Math.round(n) : res.men || 1));
    }
    (suggestions[task.id] = suggestions[task.id] || {})[key] = key === "pump_m3" ? round2(qty) : qty;
  };
  (item.tasks || []).forEach((task) => {
    const meta = taskRowMeta(task.name, lq);
    // the row's driving quantity: a typed Qty overrides the drawn-in one
    const q = task.qty !== undefined && task.qty !== "" ? Number(task.qty) || 0 : (meta.autoQty || 0);
    if (CONCRETE_POUR_TASK_MATCH.test(task.name)) {
      // legacy templates had no separate finish row — finishing rode on the pour task
      put(task, "concreter_day", crewDays(q, pourM3Block) + (hasFinishTask ? 0 : crewDays(lq.finishM2, finishM2Block)));
      if (q > 0) {
        put(task, "pump_hr", pumpHrsPour); // a pour books the pump for the whole pour (6 hrs)
        put(task, "pump_m3", q); // real measured volume — priced per m³ pumped, never rounded up
      }
    } else if (STEEL_FIXING_TASK_MATCH.test(task.name)) {
      put(task, "steelfixer_day", crewDays(q, steelTBlock)); // 1 t = a 5-man crew's day
    } else if (FINISH_TASK_MATCH.test(task.name)) {
      put(task, "concreter_day", crewDays(q, finishM2Block));
    } else if (STEEL_ERECT_TASK_MATCH.test(task.name)) {
      // Standing the frame also books the crane for the same days — steel
      // does not go up without one, and forgetting the crane is the classic
      // way a steel quote comes in short.
      const days = crewDays(q, erectTBlock);
      put(task, "erector_day", days);
      put(task, "crane_day", days > 0 ? round2(days) : 0);
    } else if (STEEL_SHEET_TASK_MATCH.test(task.name)) {
      put(task, "erector_day", crewDays(q, prodRate(rates, "Surface finishing — m² per crew-day", "m²/day", 300)));
    } else if (GENERAL_TASK_MATCH.test(task.name)) {
      put(task, "labourer_day", crewDays(task.qty !== undefined && task.qty !== "" ? Number(task.qty) || 0 : lq.concreteM3, generalM3Block));
    }
    // Bolt-up, site welding, purlins/girts and touch-up get NO auto fill
    // either: on light framing the piece count drives them far more than the
    // tonnage does, so a derived figure would be confidently wrong. Their Qty
    // columns stay blank and the cells are entered by hand.
    //
    // Formwork ("prop & form") and Excavation rows deliberately get NO auto
    // crew/plant fill — propping effort varies by system and excavator days
    // by ground conditions, so those cells stay blank and are entered
    // manually. Their Qty columns still prefill as a guide (taskRowMeta:
    // formwork m² from the FORMWORK rows, excavation m³ from Soil removal).
  });
  return suggestions;
}

export function suggestedLabourPrefill(item, rates) {
  return autoLabourQtys(item, rates);
}

/** Grand total across every quote item. */
export function computeGrandTotal(items, rates) {
  return items.reduce((s, it) => s + computeElementCost(it, rates).total, 0);
}

/**
 * Overheads/contingency/margin ladder. `overheadPct` and `contingencyPct`
 * are fractions (0.08, not 8). Returns the on-cost subtotal plus a row per
 * margin step with ex/inc-GST sell price and $/m² GFA.
 */
export function computeMarginLadder(directCost, overheadPct, contingencyPct, gfa, marginSteps) {
  const subtotal = directCost * (1 + (Number(overheadPct) || 0) + (Number(contingencyPct) || 0));
  const gfaNum = Number(gfa) || 0;
  const gstRate = getGstRate();
  const rows = marginSteps.map((margin) => {
    const sellExGst = subtotal / (1 - margin);
    const sellIncGst = sellExGst * (1 + gstRate);
    return {
      margin,
      sellExGst,
      sellIncGst,
      perM2: gfaNum > 0 ? sellExGst / gfaNum : 0,
    };
  });
  return { subtotal, rows };
}

/**
 * Client-facing scope lines for the External Quote (see
 * components/ExternalQuoteReport.jsx) — one line per element, priced as
 * that element's share of the actual sell price, so the dollar figures
 * always tie exactly to the real costed total (computeMarginLadder is the
 * one place that turns cost into a sell price — reused here, never
 * reimplemented). Elements with nothing entered (total === 0) are dropped;
 * an element with a total contributes proportionally to its own direct
 * cost's share of the whole quote's direct cost.
 */
export function computeExternalScopeLines(items, rates, overheadPct, contingencyPct, marginPct) {
  if (marginPct === undefined) marginPct = getDefaultMargin();
  const costed = items
    .map((item) => ({ id: item.id, label: item.label, directCost: computeElementCost(item, rates).total }))
    .filter((l) => l.directCost > 0);
  const directTotal = costed.reduce((s, l) => s + l.directCost, 0);
  const { rows } = computeMarginLadder(directTotal, overheadPct, contingencyPct, 0, [marginPct]);
  const totalExGst = rows[0]?.sellExGst || 0;
  const lines = costed.map((l) => ({
    id: l.id,
    label: l.label,
    sellExGst: directTotal > 0 ? (l.directCost / directTotal) * totalExGst : 0,
  }));
  return { lines, totalExGst };
}
