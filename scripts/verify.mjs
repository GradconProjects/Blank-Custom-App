#!/usr/bin/env node
/**
 * Sanity-checks the costing engine without needing a browser.
 * Run with: npm run verify
 *
 * This is NOT a full test suite — it's a fast regression net for the
 * handful of formulas that are easy to silently break (weight-basis
 * costing, the duplicate "Pump" resource columns, margin ladder maths).
 * Extend this file when you add new domain logic to lib/costing.js.
 */
import assert from "node:assert/strict";
import {
  FULL_CATALOG, RESOURCE_COLS, ELEMENT_TYPES, CATEGORY_ORDER, SECTION_ORDER, LABOUR_TEMPLATES, MARGIN_STEPS,
} from "../src/data/catalog.js";
import * as catalogAll from "../src/data/catalog.js";
import {
  computeElementCost, computeGrandTotal, computeMarginLadder,
  defaultRates, newElementItem, rateKey, suggestedLabourPrefill, computeExternalScopeLines,
  labourResourceRate, taskRowMeta, labourQuantities, autoMinimumCartage, autoConcreteSurcharge, autoEnvironmentLevy, computeRowTotal,
  computeElementUnitRates, computeProjectUnitRates,
} from "../src/lib/costing.js";
import { buildImportFromEstimate, normalizeElementName, geometryForLabel } from "../src/lib/estimateImport.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

console.log("BOMA ESTIMATES — costing engine checks\n");

/* ---------- catalog shape ---------- */
check("45 element types, 9 categories, 15 sections", () => {
  assert.equal(ELEMENT_TYPES.length, 45);
  assert.equal(CATEGORY_ORDER.length, 9);
  assert.equal(SECTION_ORDER.length, 15);
  // Stump Footings and Screw Piles are separate, individually selectable types.
  assert.ok(ELEMENT_TYPES.some((t) => t.name === "Stump Footings"), "Stump Footings present");
  assert.ok(ELEMENT_TYPES.some((t) => t.name === "Screw Piles"), "Screw Piles present");
});

check("every element type has both a category and a section", () => {
  ELEMENT_TYPES.forEach((t) => {
    assert.ok(t.category, `${t.id} is missing category`);
    assert.ok(t.section, `${t.id} is missing section`);
    assert.ok(LABOUR_TEMPLATES[t.labour], `${t.id} points at an unknown labour template "${t.labour}"`);
  });
});

check("13 material categories, 146 products (incl. CONCRETE PUMPING, INSULATION, Bored Piers subcontract, minimum cartage, levy, surcharge)", () => {
  assert.equal(FULL_CATALOG.length, 13);
  const total = FULL_CATALOG.reduce((s, c) => s + c.products.length, 0);
  assert.equal(total, 146);
  const conc = FULL_CATALOG.find((c) => c.key === "CONCRETE");
  assert.ok(conc.products.some((p) => p.name === "Production & transport surcharge" && p.unit === "m3" && p.unitCost === 9.17), "concrete surcharge product seeded at $9.17/m³");
  // Vapour barrier is its own OTHER ACCESSORIES product, distinct from Insulation
  const acc = FULL_CATALOG.find((c) => c.key === "OTHER ACCESSORIES");
  assert.ok(acc.products.some((p) => p.name === "Vapour barrier" && p.unit === "m2"), "Vapour barrier accessory present");
  assert.ok(acc.products.some((p) => p.name === "Insulation" && p.unit === "m2"), "Insulation stays its own separate product");
  const subbies = FULL_CATALOG.find((c) => c.key === "SUB CONTRACTORS / TEMPORARY WORKS");
  assert.ok(subbies.products.some((p) => p.name === "Bored Piers (subcontract)" && p.unit === "quote"), "Bored Piers quote item present");
  const stock = FULL_CATALOG.find((c) => c.key === "STOCK BAR");
  assert.ok(stock.products.some((p) => /N10 Ligatures/.test(p.name)), "N10 Ligatures stock bar present");
  // The INSULATION category carries specified products (material/thickness/
  // R-value), plain qty × rate — never weight/area/length-priced.
  const insul = FULL_CATALOG.find((c) => c.key === "INSULATION");
  assert.ok(insul, "INSULATION category exists");
  assert.ok(!insul.weightBasis && !insul.areaBasis && !insul.lengthBasis, "INSULATION is plain qty × rate");
  assert.ok(insul.products.some((p) => /Kooltherm/.test(p.name)), "specified insulation products present");
});

check("10 crew-sheet resource columns (both Pump hr and Pump m3, Formwork crew, General Labour crew, Trucks, no Factory column)", () => {
  assert.equal(RESOURCE_COLS.length, 10);
  assert.ok(!RESOURCE_COLS.some((r) => r.key === "factory_hr"), "Factory labour column removed");
  assert.ok(RESOURCE_COLS.some((r) => r.key === "labourer_day"), "General Labour column present");
  const truck = RESOURCE_COLS.find((r) => r.key === "truck_day");
  assert.ok(truck && truck.name === "Trucks" && truck.unit === "day" && !truck.crew, "Trucks plant column present (day rate, not a crew)");
  const fw = RESOURCE_COLS.find((r) => r.key === "formwork_day");
  assert.ok(fw && fw.crew, "Formwork crew column present");
  // the engine must NEVER auto-fill the formwork crew column — manual only
  const rates = defaultRates();
  const item = newElementItem(ELEMENT_TYPES.find((t) => t.id === "suspended_slab"));
  item.qtys[rateKey("FORMWORK", "Bondek", "m2")] = 120;
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 40;
  const sug = suggestedLabourPrefill(item, rates);
  assert.ok(Object.values(sug).every((cells) => cells.formwork_day === undefined), "formwork crew stays blank for manual entry");
  const pumps = RESOURCE_COLS.filter((r) => r.name === "Pump");
  assert.equal(pumps.length, 2);
  assert.notEqual(pumps[0].key, pumps[1].key); // must have distinct keys or one silently overwrites the other
});

/* ---------- direct-rate costing (qty * unitCost) ---------- */
check("Concrete costs directly: 50 m3 Minimum cartage @ $80 = $4000", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  item.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 50;
  const cost = computeElementCost(item, rates);
  assert.equal(cost.materialsTotal, 4000);
  assert.equal(cost.concreteQty, 0); // a fee row is never poured volume
});

check("Trench Mesh costs directly (NOT via tonnage): 10x 4 Bar-L12TM @ $41.19 = $411.90", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  item.qtys[rateKey("TRENCH MESH", "4 Bar-L12TM", "length")] = 10;
  const cost = computeElementCost(item, rates);
  assert.equal(cost.categoryTotals["TRENCH MESH"], 411.9);
});


/* ---------- area-basis costing (Square Mesh only) ---------- */
check("Square Mesh: qty is m² of coverage, cost = ceil(qty/sheetArea) x $/sheet, never a fractional sheet", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "slab_on_ground");
  const item = newElementItem(type);
  // SL82: sheetArea 14.4 m², $98.12/sheet. 20 m² needs ceil(20/14.4) = 2 sheets.
  item.qtys[rateKey("SQUARE MESH", "SL82", "m2")] = 20;
  const cost = computeElementCost(item, rates);
  assert.equal(Math.round(cost.categoryTotals["SQUARE MESH"] * 100) / 100, 196.24);

  // 14.4 m² exactly needs exactly 1 sheet, not 2 — ceil() must not over-round a clean multiple.
  const item2 = newElementItem(type);
  item2.qtys[rateKey("SQUARE MESH", "SL82", "m2")] = 14.4;
  assert.equal(Math.round(computeElementCost(item2, rates).categoryTotals["SQUARE MESH"] * 100) / 100, 98.12);
});

/* ---------- length-basis costing (Stock Bar only) ---------- */
check("Stock Bar: qty is m of bar needed, cost = ceil(qty/barLength) x $/bar, never a fractional bar", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "slab_on_ground");
  const item = newElementItem(type);
  // N16 - 6.0m length: barLength 6m, $17.52/bar (derived from a flat $1825/t x 9.6kg/bar).
  // 13m needs ceil(13/6) = 3 bars = $52.56.
  item.qtys[rateKey("STOCK BAR", "N16 - 6.0m length", "m")] = 13;
  const cost = computeElementCost(item, rates);
  assert.equal(Math.round(cost.categoryTotals["STOCK BAR"] * 100) / 100, 52.56);

  // 12m exactly needs exactly 2 bars, not 3 — ceil() must not over-round a clean multiple.
  const item2 = newElementItem(type);
  item2.qtys[rateKey("STOCK BAR", "N16 - 6.0m length", "m")] = 12;
  assert.equal(Math.round(computeElementCost(item2, rates).categoryTotals["STOCK BAR"] * 100) / 100, 35.04);
});

/* ---------- weight-basis costing (Processed Bar only) ---------- */
check("Processed Bar costs via Total Weight x $/tonne: 1000m N16 (1.6kg/m @ $1925/t) = $3080", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  item.qtys[rateKey("PROCESSED BAR", "N16", "m")] = 1000;
  const cost = computeElementCost(item, rates);
  assert.equal(cost.categoryTotals["PROCESSED BAR"], 3080);
});

/* ---------- blank rows cost nothing ---------- */
check("Every product listed with zero qty contributes $0 (full catalog is 'free' until filled in)", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "pool_wall");
  const item = newElementItem(type);
  const cost = computeElementCost(item, rates);
  assert.equal(cost.materialsTotal, 0);
  assert.equal(cost.labourTotal, 0);
  assert.equal(cost.total, 0);
});

/* ---------- automatic small-load charge ---------- */
check("Minimum cartage: charged per DELIVERED LOAD on the shortfall under 4 m³, matching Holcim's own table", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "slab_on_ground");
  const mk = (vol) => {
    const it = newElementItem(type);
    it.labourAuto = false;
    it.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
    it.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
    it.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = vol;
    return it;
  };
  const charge = (vol) => {
    const r = autoMinimumCartage(mk(vol), rates);
    return r ? Math.round(r.total * 100) / 100 : 0;
  };

  // Holcim's published table, load by load: (4 − load) × $80
  assert.equal(charge(4), 0);
  assert.equal(charge(3.5), 40);
  assert.equal(charge(3), 80);
  assert.equal(charge(2.5), 120);
  assert.equal(charge(2), 160);
  assert.equal(charge(1.5), 200);
  assert.equal(charge(1), 240);

  // PER LOAD, not per order: 8 m³ trucks, so 11 m³ arrives 8 + 3 and only the
  // 1 m³ short on that second truck is charged. 12 m³ splits 8 + 4: nothing.
  const eleven = autoMinimumCartage(mk(11), rates);
  assert.equal(eleven.loads, 2);
  assert.equal(eleven.lastLoad, 3);
  assert.equal(eleven.total, 80);
  assert.equal(charge(12), 0);
  assert.equal(charge(16), 0, "two full loads, nothing short");
  assert.equal(charge(30), 0, "a big pour is never charged — the old 30 m³ rule is gone");

  // the poured volume counts mixes + blinding, never the additive or the fees
  const mixed = mk(15);
  mixed.qtys[rateKey("CONCRETE", "Blinding concrete", "m3")] = 5;      // 20 total -> 8+8+4, no charge
  mixed.qtys[rateKey("CONCRETE", "Penetron (Xypex) additive", "m3")] = 15;
  assert.equal(autoMinimumCartage(mixed, rates), null);
  assert.equal(computeElementCost(mixed, rates).concreteQty, 35, "a fee never inflates poured volume"); // 15+5+15 entered rows

  // truck size is editable — 6 m³ trucks split 11 as 6+5, still nothing short
  const small = { ...rates, [rateKey("PRODUCTION", "Concrete truck load size", "m³/load")]: { unitCost: 6 } };
  assert.equal(autoMinimumCartage(mk(11), small), null);

  // a typed qty takes the row fully manual (a known 7+4 delivery, say)
  const typed = mk(11);
  typed.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  assert.equal(autoMinimumCartage(typed, rates), null);
  assert.equal(computeElementCost(typed, rates).materialsTotal, 11 * 212.5);

  // and the $/m³ honours a rates override
  const dearer = { ...rates, [rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")]: { unitCost: 100 } };
  assert.equal(autoMinimumCartage(mk(3), dearer).total, 100);
});

check("Environment levy auto-applies per m³ to the whole poured volume ($2.80), typed qty takes over", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}`);
  const rates = defaultRates();
  const item = newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground"));
  item.labourAuto = false;
  item.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  item.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 40;
  const levy = autoEnvironmentLevy(item, rates);
  assert.equal(levy.qty, 40);
  near(levy.total, 40 * 2.8);
  near(computeElementCost(item, rates).materialsTotal, 40 * 212.5 + 40 * 2.8);
  // typed wins
  item.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  assert.equal(autoEnvironmentLevy(item, rates), null);
  near(computeElementCost(item, rates).materialsTotal, 40 * 212.5);
});

check("Pumping: contract minimums bill the minimum hours, and every pump rate matches the J. King schedule", () => {
  const rates = defaultRates();
  const cat = FULL_CATALOG.find((c) => c.key === "CONCRETE PUMPING");
  assert.ok(cat, "CONCRETE PUMPING category exists");
  const rateOf = (name) => cat.products.find((p) => p.name.startsWith(name));
  assert.equal(rateOf("Line pump — up to 70m").unitCost, 200);
  assert.equal(rateOf("Line pump — 70-90m").unitCost, 240);
  assert.equal(rateOf("Boom pump — 28-32m").unitCost, 220);
  assert.equal(rateOf("Boom pump — 37m").unitCost, 230);
  assert.equal(rateOf("Boom pump — 42m").unitCost, 240);
  assert.equal(rateOf("Pumped volume").unitCost, 10);
  assert.equal(rateOf("Washout bag").unitCost, 200);
  assert.equal(rateOf("Offsite washout").unitCost, 250);
  assert.equal(rateOf("Extra labourer").unitCost, 100);
  // the "quote only" lines carry no rate — priced from the supplier's quote
  assert.equal(rateOf("Line pump — over 90m").unit, "quote");
  assert.equal(rateOf("Boom pump — 47m").unit, "quote");

  // 4-hour minimum: 1 hour on site still bills 4
  const boom = rateOf("Boom pump — 28-32m");
  const r = rates[rateKey("CONCRETE PUMPING", boom.name, boom.unit)];
  assert.equal(r.minQty, 4, "the minimum travels into the rates object, so it is editable");
  assert.equal(computeRowTotal(cat, r, 1), 4 * 220);
  assert.equal(computeRowTotal(cat, r, 4), 4 * 220);
  assert.equal(computeRowTotal(cat, r, 6), 6 * 220, "above the minimum bills the real hours");
  assert.equal(computeRowTotal(cat, r, 0), 0, "a blank row still costs nothing");
  // 6-hour minimum on the hose hand, 1-hour on travel
  const hand = rateOf("Extra labourer");
  assert.equal(computeRowTotal(cat, rates[rateKey("CONCRETE PUMPING", hand.name, hand.unit)], 2), 6 * 100);
  const travel = rateOf("Travel charge");
  assert.equal(computeRowTotal(cat, rates[rateKey("CONCRETE PUMPING", travel.name, travel.unit)], 0.5), 1 * 220);
  // an element prices them through the normal path
  const item = newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground"));
  item.labourAuto = false;
  item.qtys[rateKey("CONCRETE PUMPING", boom.name, boom.unit)] = 2;   // billed as 4
  assert.equal(computeElementCost(item, rates).categoryTotals["CONCRETE PUMPING"], 880);
});

check("Production & transport surcharge auto-applies per m³ to the WHOLE poured volume ($9.17), typed qty takes over, rate editable", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}`);
  const rates = defaultRates();
  const item = newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground"));
  item.labourAuto = false;
  item.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0; // isolate the surcharge
  item.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 50; // 50 ≥ 30: no small-load, but the surcharge still applies
  const surKey = rateKey("CONCRETE", "Production & transport surcharge", "m3");
  const sur = autoConcreteSurcharge(item, rates);
  assert.equal(sur.qty, 50);
  near(sur.total, 50 * 9.17);
  const cost = computeElementCost(item, rates);
  near(cost.materialsTotal, 50 * 212.5 + 50 * 9.17);
  assert.equal(cost.concreteQty, 50, "the surcharge fee must not inflate poured volume");
  near(labourQuantities(item, rates).concreteM3, 50, "nor the labour engine's concrete m³");
  // a typed qty on the surcharge row switches it fully manual (no double-charge)
  item.qtys[surKey] = 10;
  assert.equal(autoConcreteSurcharge(item, rates), null);
  near(computeElementCost(item, rates).materialsTotal, 50 * 212.5 + 10 * 9.17);
  // the rate honours a rates-library override — editable in place, the Rates modal, everywhere
  delete item.qtys[surKey];
  rates[surKey] = { unitCost: 12.5 };
  near(autoConcreteSurcharge(item, rates).total, 50 * 12.5);
});

check("Quote statuses: 'Completed Estimating' sits between Estimating and Quoting, with a style entry", () => {
  const { QUOTE_STATUSES, QUOTE_STATUS_STYLES } = catalogAll;
  const i = QUOTE_STATUSES.indexOf("Completed Estimating");
  assert.ok(i > QUOTE_STATUSES.indexOf("Estimating") && i < QUOTE_STATUSES.indexOf("Quoting"), "pipeline order");
  QUOTE_STATUSES.forEach((s) => assert.ok(QUOTE_STATUS_STYLES[s], `every status needs a style entry (missing: ${s})`));
});

check("Formwork rates: Conventional seeds $60/m² and Edgeform $8/lm", () => {
  const rates = defaultRates();
  assert.equal(rates[rateKey("FORMWORK", "Conventional", "m2")].unitCost, 60);
  assert.equal(rates[rateKey("FORMWORK", "Edgeform", "m")].unitCost, 8);
});

check("Subcontract 'quote' items: the received quote is entered as the rate — qty 1 books the whole quote", () => {
  const rates = defaultRates();
  const item = newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground"));
  item.labourAuto = false;
  const key = rateKey("SUB CONTRACTORS / TEMPORARY WORKS", "Screw Piling", "quote");
  item.qtys[key] = 1;
  assert.equal(computeElementCost(item, rates).materialsTotal, 0); // no quote entered yet — costs nothing
  rates[key] = { unitCost: 45000 }; // the quote received, typed straight on the row
  assert.equal(computeElementCost(item, rates).materialsTotal, 45000);
});

/* ---------- labour matrix ---------- */
check("Labour rolls up: 8 Concrete Crew days + 20 Pump hrs on one task = $17,000, folds into element total", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  const pourTask = item.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  pourTask.qtys["concreter_day"] = 8; // rows default PER PERSON: 8 man-days × $500
  pourTask.qtys["pump_hr"] = 20; // 20 * $250
  const cost = computeElementCost(item, rates);
  assert.equal(cost.labourTotal, 8 * 500 + 20 * 250);
  assert.equal(cost.total, cost.materialsTotal + cost.labourTotal + cost.additionalTotal);
});

check("Labour totals split correctly across BOTH Pump columns (hr and m³) without collision", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "suspended_slab");
  const item = newElementItem(type);
  item.labourAuto = false; // pin the two typed pump cells only
  const task = item.tasks[0];
  task.qtys["pump_hr"] = 10; // 10 * $250 = 2500
  task.qtys["pump_m3"] = 40; // 40 * $10  = 400
  const cost = computeElementCost(item, rates);
  assert.equal(cost.resourceCosts["pump_hr"], 2500);
  assert.equal(cost.resourceCosts["pump_m3"], 400);
  assert.equal(cost.labourTotal, 2900);
});

/* ---------- crew auto labour (fractional crew-days) ---------- */
check("Auto labour: crew-days from crew-day blocks with decimals kept (10 m³/crew-day pour, 1 t/crew-day steel), empty cells only", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 50; // every 10 m³ = one Concrete Crew day -> 5 crew-days
  item.qtys[rateKey("PROCESSED BAR", "N16", "m")] = 2000; // 3.2 t -> 3.2 Steel Crew days (decimals kept, no ceiling)
  const pourTask = item.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  const tieTask = item.tasks.find((t) => t.name === "Tie reinforcement");

  // rows default PER PERSON, so suggestions land as man-days: crews × men
  const suggestions = suggestedLabourPrefill(item, rates);
  assert.equal(suggestions[pourTask.id].concreter_day, 15); // 5 crew-days × 3 men
  assert.equal(suggestions[tieTask.id].steelfixer_day, 16); // 3.2 crew-days × 5 men
  // switched to per crew, the same rows suggest raw crew-days
  pourTask.crewMode = "crew"; tieTask.crewMode = "crew";
  const crewSug = suggestedLabourPrefill(item, rates);
  assert.equal(crewSug[pourTask.id].concreter_day, 5);
  assert.equal(crewSug[tieTask.id].steelfixer_day, 3.2);
  pourTask.crewMode = undefined; tieTask.crewMode = undefined;
  // a pour books the pump: flat 6 hrs plus the true m³ pumped (never rounded)
  assert.equal(suggestions[pourTask.id].pump_hr, 6);
  assert.equal(suggestions[pourTask.id].pump_m3, 50);

  // A cell the estimator already filled in is never included in the suggestions,
  // so a typed value can never be overridden by the engine.
  pourTask.qtys["concreter_day"] = 3;
  const suggestions2 = suggestedLabourPrefill(item, rates);
  assert.equal(suggestions2[pourTask.id].concreter_day, undefined, "must not suggest a value for an already-filled cell");
  assert.equal(suggestions2[pourTask.id].pump_hr, 6); // other cells on the row still auto
  assert.equal(suggestions2[tieTask.id].steelfixer_day, 16); // unrelated task/resource still suggested
});

check("Fractional crew-days: tiny quantities stay fractional (no ceiling, no minimum whole crew), cost = days × men × man-day rate", () => {
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}${msg ? " — " + msg : ""}`);
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "slab_on_ground");
  const item = newElementItem(type);
  // 0.13 t of steel -> 0.13 Steel Crew days, costed 0.13 × 5 men × $650.
  item.qtys[rateKey("PROCESSED BAR", "N12", "m")] = 146; // 146 m × 0.888 kg/m ≈ 0.13 t
  const tieTask = item.tasks.find((t) => t.name === "Tie reinforcement");
  const sug = suggestedLabourPrefill(item, rates);
  near(sug[tieTask.id].steelfixer_day, 0.65); // 0.13 crew-days × 5 men (per-person default)
  const shown = taskRowMeta(tieTask.name, labourQuantities(item, rates)).autoQty;
  assert.ok(Math.abs(shown - 0.13) < 0.005, `Qty column must display the true tonnage (~0.13), got ${shown}`);
  near(computeElementCost(item, rates).resourceCosts.steelfixer_day, 0.13 * 5 * 650);

  // 4 m³ of concrete -> 0.4 Concrete Crew days = 1.2 man-days, pump 6 hrs + true 4 m³.
  const small = newElementItem(type);
  small.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 4;
  const pourTask = small.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  const sug2 = suggestedLabourPrefill(small, rates);
  near(sug2[pourTask.id].concreter_day, 1.2);
  assert.equal(sug2[pourTask.id].pump_hr, 6);
  assert.equal(sug2[pourTask.id].pump_m3, 4);
});

check("Per-row crew flexibility: per-crew rows cost days × own men × man-day rate; per-person rows cost man-days directly", () => {
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}${msg ? " — " + msg : ""}`);
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  item.labourAuto = false;
  const pourTask = item.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  pourTask.qtys.concreter_day = 2;
  // default: PER PERSON — 2 man-days costed directly at the $500 day rate
  near(computeElementCost(item, rates).resourceCosts.concreter_day, 2 * 500);
  // switched to per crew: cells become crew-days × the column default (3 men)
  pourTask.crewMode = "crew";
  near(computeElementCost(item, rates).resourceCosts.concreter_day, 2 * 3 * 500);
  // this row's own crew is 4 men — no blanket crew size
  pourTask.crewSize = 4;
  near(computeElementCost(item, rates).resourceCosts.concreter_day, 2 * 4 * 500);
  // back to per person: man-days again, crewSize ignored
  pourTask.crewMode = "person";
  near(computeElementCost(item, rates).resourceCosts.concreter_day, 2 * 500);
  // fractional cells survive untouched (no whole-crew rounding)
  pourTask.crewMode = "crew";
  pourTask.qtys.concreter_day = 1.5;
  near(computeElementCost(item, rates).resourceCosts.concreter_day, 1.5 * 4 * 500);
  near(computeElementCost(item, rates).resourceTotals.concreter_day, 1.5);
  // a per-person row's AUTO suggestion converts crews -> man-days (crews × men)
  const auto = newElementItem(type);
  auto.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 50; // 5 crew-days
  const autoPour = auto.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  autoPour.crewMode = "person";
  autoPour.crewSize = 2;
  near(suggestedLabourPrefill(auto, rates)[autoPour.id].concreter_day, 10, "5 crews × 2 men = 10 man-days");
  near(computeElementCost(auto, rates).resourceCosts.concreter_day, 10 * 500);
});

check("Seamless labour: computeElementCost costs the auto crew days live (no write-back), and a typed cell overrides", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  assert.equal(item.labourAuto, true, "new elements default to auto labour");
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 50;
  // rows default PER PERSON: pour 50 m³ -> 5 crew-days × 3 men = 15 man-days
  // × $500; washout 50/60 = 0.83 crews × 3 = 2.49 man-days × $400; pump
  // 6 hr @ $250 + 50 m³ @ $10.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}`);
  const cost = computeElementCost(item, rates);
  assert.equal(cost.resourceTotals.concreter_day, 15);
  near(cost.resourceTotals.labourer_day, 2.49);
  assert.equal(cost.resourceTotals.pump_hr, 6);
  assert.equal(cost.resourceTotals.pump_m3, 50);
  near(cost.labourTotal, 15 * 500 + 2.49 * 400 + 6 * 250 + 50 * 10);
  // tasks were NOT written to — the derivation is live
  assert.ok(item.tasks.every((t) => Object.keys(t.qtys).length === 0), "auto labour must not write into tasks");
  // a typed cell wins over the engine
  const pourTask = item.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  pourTask.qtys.concreter_day = 4;
  assert.equal(computeElementCost(item, rates).resourceTotals.concreter_day, 4);
  // quantities changing flow straight through (the old one-shot prefill went stale here)
  pourTask.qtys.concreter_day = undefined;
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 100;
  assert.equal(computeElementCost(item, rates).resourceTotals.concreter_day, 30); // 10 crews × 3 men (per-person default)
  // auto off = fully manual matrix
  item.labourAuto = false;
  assert.equal(computeElementCost(item, rates).resourceTotals.concreter_day, 0);
});

check("Crew sheet: Finish row draws mesh m², a typed row Qty overrides the drawn quantity, legacy task names still auto", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "slab_on_ground");
  const item = newElementItem(type);
  item.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 36; // the screenshot scenario: 36 m³
  item.qtys[rateKey("SQUARE MESH", "SL82", "m2")] = 200; // finish area drawn from mesh coverage
  const finishTask = item.tasks.find((t) => t.name === "Finish concrete surfaces");
  const sug = suggestedLabourPrefill(item, rates);
  assert.equal(sug[finishTask.id].concreter_day, 2.01); // 200/300 = 0.67 crew-days × 3 men (per-person default)
  const pourTask = item.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  assert.equal(sug[pourTask.id].concreter_day, 10.8); // 36/10 = 3.6 crew-days × 3 men — finishing on its own row

  // typing a row Qty overrides what the row draws on
  pourTask.qty = 20;
  const sug2 = suggestedLabourPrefill(item, rates);
  assert.equal(sug2[pourTask.id].concreter_day, 6); // 20/10 = 2 crew-days × 3 men
  assert.equal(sug2[pourTask.id].pump_m3, 20); // pump volume follows the override too

  // an element saved before the crew sheet keeps auto on its old task names
  const legacy = newElementItem(type);
  legacy.tasks = [
    { id: "L1", name: "Formwork / box out", qtys: {} },
    { id: "L2", name: "Pour concrete (pump)", qtys: {} },
    { id: "L3", name: "Tie steel", qtys: {} },
  ];
  legacy.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 40;
  legacy.qtys[rateKey("FORMWORK", "Bondek", "m2")] = 100;
  const sug3 = suggestedLabourPrefill(legacy, rates);
  // formwork rows get NO auto crew fill — entered manually, always — but
  // the Qty column still shows the drawn formwork m² as a guide
  assert.equal(sug3["L1"], undefined, "formwork/prop & form crew cells must stay blank");
  assert.equal(taskRowMeta("Formwork / box out", labourQuantities(legacy, rates)).autoQty, 100);
  assert.equal(sug3["L2"].concreter_day, 12); // 40/10 = 4 crew-days × 3 men
  assert.equal(sug3["L2"].pump_m3, 40); // legacy pump task still pumps the true volume
  assert.equal(sug3["L2"].pump_hr, 6); // whole-pour pump booking
});

check("Suspended slab 2.99 t of steel is 2.99 Steel Crew days (decimals kept), and new elements carry the crew-engine marker (labourVer 2)", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}`);
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "suspended_slab");
  const item = newElementItem(type);
  assert.equal(item.labourVer, 2, "new elements must be born at labourVer 2 so the stale-cell migration never wipes them");
  item.qtys[rateKey("PROCESSED BAR", "N16", "m")] = 1868; // 1.6 kg/m -> 2.9888 t, shown as 2.99
  const tie = item.tasks.find((t) => /tie/i.test(t.name));
  assert.equal(taskRowMeta(tie.name, labourQuantities(item, rates)).autoQty, 2.99);
  near(suggestedLabourPrefill(item, rates)[tie.id].steelfixer_day, 14.95); // 2.99 crews × 5 men, no whole-crew ceiling
  near(computeElementCost(item, rates).resourceCosts.steelfixer_day, 2.99 * 5 * 650);
});

check("Fractional crew cells kept as typed (0.5 stays 0.5, 1.2 stays 1.2); plant days still book whole; pump m³ a true volume", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}`);
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  item.labourAuto = false;
  const pourTask = item.tasks.find((t) => t.name === "Pour / place / vibrate concrete");
  const tieTask = item.tasks.find((t) => t.name === "Tie reinforcement");
  pourTask.qtys.concreter_day = 1.2; // stays 1.2 crew-days
  tieTask.qtys.steelfixer_day = 0.5; // stays half a crew-day
  pourTask.qtys.excavator_day = 0.5; // plant still books whole days -> 1
  pourTask.qtys.pump_m3 = 36.5; // real measured volume, never rounded
  const cost = computeElementCost(item, rates);
  near(cost.resourceTotals.concreter_day, 1.2);
  near(cost.resourceTotals.steelfixer_day, 0.5);
  assert.equal(cost.resourceTotals.excavator_day, 1);
  assert.equal(cost.resourceTotals.pump_m3, 36.5);
  near(cost.labourTotal, 1.2 * 500 + 0.5 * 650 + 1 * 900 + 36.5 * 10); // per-person default: man-days × day rate
});

check("Excavate row: Qty prefills from the Soil removal (m³) line, but excavator/crew cells stay blank for manual entry", () => {
  const rates = defaultRates();
  const item = newElementItem(ELEMENT_TYPES.find((t) => t.id === "excavation_bulk"));
  item.qtys[rateKey("OTHER ALLOWANCES", "Soil removal", "m3")] = 85;
  const excTask = item.tasks.find((t) => /excavate/i.test(t.name));
  assert.equal(taskRowMeta(excTask.name, labourQuantities(item, rates)).autoQty, 85);
  const sug = suggestedLabourPrefill(item, rates);
  assert.ok(!sug[excTask.id] || sug[excTask.id].excavator_day === undefined, "excavator days must never auto-fill");
});

check("Crew rates: per-person man-day keys — both stale 'day' and crew-era 'crew-day' overrides are retired", () => {
  const rates = defaultRates();
  const crew = RESOURCE_COLS.find((r) => r.key === "concreter_day");
  assert.equal(crew.unit, "man-day", "crew columns price per person under the man-day unit");
  assert.equal(crew.rate, 500, "catalog default is the per-person day rate");
  assert.equal(crew.men, 3, "column keeps its default men-per-crew for rows that don't set their own");
  // overrides saved under either older generation of keys must not apply
  rates[rateKey("LABOUR", "Concrete Crew", "day")] = { unitCost: 9999 };
  rates[rateKey("LABOUR", "Concrete Crew", "crew-day")] = { unitCost: 8888 };
  assert.equal(labourResourceRate(rates, crew), 500, "man-day catalog default must win over both stale key generations");
  // an override saved under the NEW man-day key applies as normal
  rates[rateKey("LABOUR", "Concrete Crew", "man-day")] = { unitCost: 550 };
  assert.equal(labourResourceRate(rates, crew), 550);
  // pump m³ rate is $10 under its new m³ key
  const pumpM3 = RESOURCE_COLS.find((r) => r.key === "pump_m3");
  assert.equal(labourResourceRate(defaultRates(), pumpM3), 10);
});

/* ---------- External Quote scope lines (client-facing $ always ties to the real sell price) ---------- */
check("computeExternalScopeLines: per-element sell allocation sums exactly to the real margin-ladder sell price", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~= ${b}`);
  const rates = defaultRates();
  const a = newElementItem(ELEMENT_TYPES.find((t) => t.id === "strip_footings"));
  a.labourAuto = false;
  a.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 10; // $2125 direct
  a.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0; // typed 0 disables the auto small-load charge — this check pins the allocation maths
  a.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  a.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0; // and the auto surcharge
  const b = newElementItem(ELEMENT_TYPES.find((t) => t.id === "capping_beam"));
  b.labourAuto = false;
  b.qtys[rateKey("CONCRETE", "32 mpa", "m3")] = 5; // $1107.50 direct
  b.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  b.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  b.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
  const c = newElementItem(ELEMENT_TYPES.find((t) => t.id === "pool_wall")); // no qty entered — must be dropped
  const { lines, totalExGst } = computeExternalScopeLines([a, b, c], rates, 0.08, 0.05, 0.3);

  assert.equal(lines.length, 2, "the zero-qty element must not produce a scope line");
  const directTotal = 2125 + 1107.5;
  const expectedTotal = (directTotal * 1.13) / 0.7; // matches computeMarginLadder's own formula
  near(totalExGst, expectedTotal);
  near(lines.reduce((s, l) => s + l.sellExGst, 0), totalExGst);
  near(lines[0].sellExGst, (2125 / directTotal) * expectedTotal);
});

/* ---------- custom / one-off items ---------- */
check("Custom line items add directly (qty * rate)", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "screw_piles");
  const item = newElementItem(type);
  item.additional.push({ id: "x", name: "Difficult access allowance", unit: "item", qty: 1, rate: 2500 });
  const cost = computeElementCost(item, rates);
  assert.equal(cost.additionalTotal, 2500);
  assert.equal(cost.total, 2500);
});

/* ---------- rate overrides / fallback ---------- */
check("A rates override changes cost; a MISSING key falls back to catalog default rather than $0", () => {
  const rates = defaultRates();
  const type = ELEMENT_TYPES.find((t) => t.id === "strip_footings");
  const item = newElementItem(type);
  const key = rateKey("CONCRETE", "32 mpa", "m3");
  item.qtys[key] = 10;
  item.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0; // typed 0 disables the auto charge — this check pins override/fallback maths
  item.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  item.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;

  const before = computeElementCost(item, rates).materialsTotal;
  assert.equal(before, 10 * 221.5);

  rates[key] = { unitCost: 300, unitWeight: null };
  const after = computeElementCost(item, rates).materialsTotal;
  assert.equal(after, 3000);

  delete rates[key]; // simulate an old saved rates blob missing this key
  const fallback = computeElementCost(item, rates).materialsTotal;
  assert.equal(fallback, 10 * 221.5); // falls back to catalog default, not 0
});

/* ---------- multi-element grand total ---------- */
check("Grand total sums every element's total across the whole quote", () => {
  const rates = defaultRates();
  const a = newElementItem(ELEMENT_TYPES.find((t) => t.id === "strip_footings"));
  a.labourAuto = false; // this check pins the MATERIALS maths; auto labour has its own checks
  a.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 10; // $2125
  a.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0; // typed 0 disables the auto charge
  a.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  a.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
  const b = newElementItem(ELEMENT_TYPES.find((t) => t.id === "capping_beam"));
  b.labourAuto = false;
  b.qtys[rateKey("CONCRETE", "32 mpa", "m3")] = 5; // $1107.50
  b.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  b.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  b.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
  const total = computeGrandTotal([a, b], rates);
  assert.equal(total, 10 * 212.5 + 5 * 221.5);
});

/* ---------- margin ladder ---------- */
const approxEqual = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);

check("Margin ladder: overheads/contingency compound onto direct cost, then margin divides (not multiplies)", () => {
  const directCost = 100000;
  const { subtotal, rows } = computeMarginLadder(directCost, 0.08, 0.05, 500, MARGIN_STEPS);
  approxEqual(subtotal, 113000);
  const row30 = rows.find((r) => Math.abs(r.margin - 0.3) < 1e-9);
  approxEqual(row30.sellExGst, subtotal / 0.7);
  approxEqual(row30.sellIncGst, row30.sellExGst * 1.1);
  approxEqual(row30.perM2, subtotal / 0.7 / 500);
});

check("Margin ladder with GFA=0 reports $/m² as 0, not an error", () => {
  const { rows } = computeMarginLadder(50000, 0, 0, 0, MARGIN_STEPS);
  rows.forEach((r) => assert.equal(r.perM2, 0));
});

/* ---------- Estimates -> Quotes import bridge (lib/estimateImport.js) ---------- */
const estLine = (over) => ({
  stage: "Foundations", category: "Bored Pier", element: "Bored Pier 1", elementId: "EL01",
  materialGroup: "Concrete", material: "", spec: "", qty: 0, unit: "m³", waste: 0, lap: 0,
  finalQty: 0, formula: "", linkedElement: "", notes: "", ...over,
});

check("Import: unambiguous grade + bar diameter prefill cleanly with no flags", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: { name: "Test Job" },
    lines: [
      estLine({ materialGroup: "Concrete", material: "N20 concrete", unit: "m³", finalQty: 12.5 }),
      estLine({ materialGroup: "Reinforcement", material: "N16", unit: "m", finalQty: 340 }),
    ],
  });
  assert.equal(quote.items.length, 1);
  const item = quote.items[0];
  assert.equal(item.typeId, "piles_bored");
  assert.equal(item.qtys[rateKey("CONCRETE", "20 mpa", "m3")], 12.5);
  assert.equal(item.qtys[rateKey("PROCESSED BAR", "N16", "m")], 340);
  assert.equal(flags.length, 0, `expected no flags, got: ${flags.join(" | ")}`);
});

check("Import: element type with no Quotes equivalent produces a flag and no item", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: { name: "Test Job" },
    lines: [
      { ...estLine({}), category: "Water Tank (in-ground)", element: "Water Tank 1", elementId: "EL02", finalQty: 8 },
    ],
  });
  assert.equal(quote.items.length, 0);
  assert.ok(flags.some((f) => f.includes("Water Tank")), `expected a Water Tank flag, got: ${flags.join(" | ")}`);
});

check("Import: Concrete Stair maps to the staircase element type (used to be unmapped/flagged)", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: { name: "Test Job" },
    lines: [
      { ...estLine({}), category: "Concrete Stair", element: "Stair 1", elementId: "EL06",
        materialGroup: "Concrete", material: "N25 concrete", spec: "Stair (steps+waist+landing)", unit: "m³", finalQty: 4.2 },
    ],
  });
  assert.equal(quote.items.length, 1);
  const item = quote.items[0];
  assert.equal(item.typeId, "staircase");
  assert.equal(item.qtys[rateKey("CONCRETE", "25 mpa", "m3")], 4.2);
});

check("Import: Column Base Plate / Grout Pad maps to the new column_base_plate element type", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: { name: "Test Job" },
    lines: [
      { ...estLine({}), category: "Column Base Plate / Grout Pad", element: "Base Plate C1", elementId: "EL07",
        materialGroup: "Concrete", material: "N40 concrete", unit: "m³", finalQty: 0.3 },
    ],
  });
  assert.equal(quote.items.length, 1);
  const item = quote.items[0];
  assert.equal(item.typeId, "column_base_plate");
  assert.equal(item.qtys[rateKey("CONCRETE", "40 mpa", "m3")], 0.3);
});

check("Import: ambiguous concrete grade (multiple products) still prefills the plain mix and flags it", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [estLine({ material: "N32 concrete", finalQty: 6 })],
  });
  const item = quote.items[0];
  assert.equal(item.qtys[rateKey("CONCRETE", "32 mpa", "m3")], 6); // plain mix preferred over Agilia/walls variants
  assert.ok(flags.some((f) => f.includes("N32") && f.includes("verify")), `expected an ambiguity flag, got: ${flags.join(" | ")}`);
});

check("Import: mesh reinforcement (m²) maps straight to Square Mesh m² qty; trench mesh with the same SL/RL code is flagged instead", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [
      { ...estLine({}), category: "Slab on Ground", element: "Slab 1", elementId: "EL04",
        materialGroup: "Reinforcement", material: "SL82", spec: "Mesh ×1 layer(s)", unit: "m²", finalQty: 55.5 },
      { ...estLine({}), category: "Strip Footing", element: "Footing 1", elementId: "EL05",
        materialGroup: "Reinforcement", material: "SL62", spec: "Trench mesh", unit: "m²", finalQty: 12 },
    ],
  });
  const slab = quote.items.find((i) => i.typeId === "slab_on_ground");
  assert.equal(slab.qtys[rateKey("SQUARE MESH", "SL82", "m2")], 55.5); // raw m², NOT converted to a sheet count here
  const footing = quote.items.find((i) => i.typeId === "strip_footings");
  assert.equal(footing.qtys[rateKey("SQUARE MESH", "SL62", "m2")], undefined); // must NOT be silently mapped
  assert.ok(flags.some((f) => f.includes("Trench Mesh") && f.includes("SL62")), `expected a trench-mesh flag, got: ${flags.join(" | ")}`);
});

check("Import: wall formwork area maps to Walls; other m² formwork maps to Conventional and is still flagged for review", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [
      { ...estLine({}), category: "Concrete Wall / Core", element: "Wall 1", elementId: "EL03",
        materialGroup: "Formwork", material: "Wall formwork", spec: "Selected faces", unit: "m²", finalQty: 45 },
      { ...estLine({}), category: "Concrete Wall / Core", element: "Wall 1", elementId: "EL03",
        materialGroup: "Formwork", material: "Opening reveals", spec: "", unit: "m²", finalQty: 3 },
    ],
  });
  const item = quote.items[0];
  assert.equal(item.qtys[rateKey("FORMWORK", "Walls", "m2")], 45);
  assert.equal(item.qtys[rateKey("FORMWORK", "Conventional", "m2")], 3); // non-wall formwork now crosses over too, not just flagged
  assert.ok(flags.some((f) => f.includes("Opening reveals")), `expected the non-wall formwork to still be flagged for review, got: ${flags.join(" | ")}`);
});

check("Import: a named formwork system on the spec (Bondek) maps to that exact FORMWORK product, and per-m edge formwork maps to Edgeform", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [
      { ...estLine({}), category: "Suspended Slab", element: "Slab 1", elementId: "EL07",
        materialGroup: "Formwork", material: "Soffit formwork", spec: "net area · Bondek (permanent metal deck)", unit: "m²", finalQty: 120 },
      { ...estLine({}), category: "Suspended Slab", element: "Slab 1", elementId: "EL07",
        materialGroup: "Formwork", material: "Edgeform — perimeter edge formwork", spec: "200mm high edge", unit: "m", finalQty: 44 },
      // Reveals and step-down faces are also per-m edge boards now — they
      // land on the same Edgeform product and sum with the perimeter run.
      { ...estLine({}), category: "Suspended Slab", element: "Slab 1", elementId: "EL07",
        materialGroup: "Formwork", material: "Opening reveals", spec: "200mm high reveal", unit: "m", finalQty: 6 },
      { ...estLine({}), category: "Suspended Slab", element: "Slab 1", elementId: "EL07",
        materialGroup: "Formwork", material: "Step-down face formwork", spec: "150mm deep step ×1 riser(s)", unit: "m", finalQty: 5 },
    ],
  });
  const item = quote.items[0];
  assert.equal(item.qtys[rateKey("FORMWORK", "Bondek", "m2")], 120);
  assert.equal(item.qtys[rateKey("FORMWORK", "Edgeform", "m")], 55); // 44 edge + 6 reveals + 5 step faces
  assert.ok(!flags.some((f) => f.includes("Bondek")), `Bondek should map cleanly without a flag, got: ${flags.join(" | ")}`);
});

check("Import: insulation lines with catalog product names map onto the INSULATION products (m² boards AND per-m strips)", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [
      { ...estLine({}), category: "Slab on Ground", element: "Slab 1", elementId: "EL08",
        materialGroup: "Insulation", material: "XPS rigid board 50mm (R1.47)", spec: "Under-slab / under-element insulation", unit: "m²", finalQty: 210 },
      { ...estLine({}), category: "Slab on Ground", element: "Slab 1", elementId: "EL08",
        materialGroup: "Insulation", material: "Slab edge insulation — 30mm XPS 300mm strip", spec: "Edge / strip insulation", unit: "m", finalQty: 60 },
      { ...estLine({}), category: "Slab on Ground", element: "Slab 1", elementId: "EL08",
        materialGroup: "Insulation", material: "Some unknown foam", spec: "", unit: "m²", finalQty: 5 },
    ],
  });
  const item = quote.items[0];
  assert.equal(item.qtys[rateKey("INSULATION", "XPS rigid board 50mm (R1.47)", "m2")], 210);
  assert.equal(item.qtys[rateKey("INSULATION", "Slab edge insulation — 30mm XPS 300mm strip", "m")], 60);
  assert.ok(flags.some((f) => f.includes("Some unknown foam")), `unknown insulation should be flagged, got: ${flags.join(" | ")}`);
});

check("Import: vapour barrier m² lines map onto the OTHER ACCESSORIES 'Vapour barrier' product (distinct from Insulation)", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [
      { ...estLine({}), category: "Slab on Ground", element: "Slab 1", elementId: "EL09",
        materialGroup: "Base/Blinding", material: "Vapour barrier — 200um polyethylene", spec: "incl. 10% laps/upturns", unit: "m²", finalQty: 339.9 },
    ],
  });
  const item = quote.items[0];
  assert.equal(item.qtys[rateKey("OTHER ACCESSORIES", "Vapour barrier", "m2")], 339.9);
  assert.equal(item.qtys[rateKey("INSULATION", "Vapour barrier", "m2")], undefined, "must not land on any Insulation product");
  assert.ok(!flags.some((f) => f.includes("Vapour barrier")), `vapour barrier must map cleanly, got flags: ${flags.join(" | ")}`);
});

check("Catalog: Bondek is a priced FORMWORK product (m²) so it appears in the Rates modal and the import can target it", () => {
  const fw = FULL_CATALOG.find((c) => c.key === "FORMWORK");
  const bondek = fw.products.find((p) => p.name === "Bondek");
  assert.ok(bondek, "Bondek missing from FORMWORK catalog");
  assert.equal(bondek.unit, "m2");
  assert.ok(Number(bondek.unitCost) > 0, "Bondek has no default rate");
});

check("Import: a count-only reinforcement line (no length, e.g. ligatures) is flagged with its weight, never silently dropped", () => {
  const { quote, flags } = buildImportFromEstimate({
    project: {},
    lines: [
      estLine({ material: "N20 concrete", finalQty: 1 }),
      { ...estLine({}), materialGroup: "Reinforcement", material: "N10",
        spec: "Circular ligatures (top+mid+bottom zones)", unit: "no.", finalQty: 39 },
      { ...estLine({}), materialGroup: "Reinforcement", material: "N10",
        spec: "Circular ligatures — mass", unit: "kg", finalQty: 40.01 },
    ],
  });
  const item = quote.items[0];
  assert.equal(item.qtys[rateKey("PROCESSED BAR", "N10", "m")], undefined); // no length was ever given — must not be invented
  // The count line and its mass line use unrelated spec text in the source
  // tool ("Circular ligatures (top+mid+bottom zones)" vs "Circular
  // ligatures — mass"), so this bridge can't reliably recognise them as one
  // pair and merge them into a single flag — it raises one flag per line
  // instead. That's a safe failure mode (both numbers stay visible) even if
  // slightly redundant; what actually matters is that the real weight (not
  // just the bare bar count) shows up somewhere in the flags.
  assert.ok(flags.some((f) => f.includes("39.00") && f.includes("no.")), `expected the bar count to be flagged, got: ${flags.join(" | ")}`);
  assert.ok(flags.some((f) => f.includes("40.01") && f.includes("kg")), `expected the actual weight to be flagged too, got: ${flags.join(" | ")}`);
});

const { computeTenderProjectSum, parseTenderPrice } = await import("../src/lib/tenderQuoteDefaults.js");

check("Tender Project Sum: line-item '$… + GST' prices sum ex-GST; override replaces; markup is a whole %; GST added last and only when on", () => {
  const items = [
    { id: "a", price: "$46,050.47 + GST" },
    { id: "b", price: "$3,949.53 + GST" },
    { id: "c", price: "" }, // an unpriced item contributes $0, never NaN
  ];
  // plain sum, GST on (the defaults for a legacy tenderQuote with none of the new fields)
  let ps = computeTenderProjectSum({ items });
  assert.equal(ps.itemsSum.toFixed(2), "50000.00");
  assert.equal(ps.exGst.toFixed(2), "50000.00");
  assert.ok(ps.gstOn && !ps.markupOn);
  assert.equal(ps.gst.toFixed(2), "5000.00");
  assert.equal(ps.incGst.toFixed(2), "55000.00");
  // markup: 10 means 10%, applied ex-GST, before GST
  ps = computeTenderProjectSum({ items, markupOn: true, markupPct: "10" });
  assert.equal(ps.markupAmt.toFixed(2), "5000.00");
  assert.equal(ps.exGst.toFixed(2), "55000.00");
  assert.equal(ps.incGst.toFixed(2), "60500.00");
  // markup ticked but blank % — no NaN, no markup line
  ps = computeTenderProjectSum({ items, markupOn: true, markupPct: "" });
  assert.ok(!ps.markupOn && ps.exGst.toFixed(2) === "50000.00");
  // override replaces the items sum entirely (and markup applies to IT)
  ps = computeTenderProjectSum({ items, projectSumOverride: "$48,000.00", markupOn: true, markupPct: 5 });
  assert.ok(ps.hasOverride);
  assert.equal(ps.base.toFixed(2), "48000.00");
  assert.equal(ps.exGst.toFixed(2), "50400.00");
  // GST off: ex-GST figure is the whole story
  ps = computeTenderProjectSum({ items, gstOn: false });
  assert.ok(!ps.gstOn && ps.gst === 0);
  assert.equal(ps.incGst.toFixed(2), ps.exGst.toFixed(2));
  // price-string parsing survives commas, $ and the "+ GST" suffix
  assert.equal(parseTenderPrice("$1,234,567.89 + GST"), 1234567.89);
  assert.equal(parseTenderPrice("no digits here"), 0);
});

check("Benchmark rates: whole cost over the geometry measured in Estimates — $/lm, $/m², $/m³, in that order, only where the measure exists", () => {
  const rates = defaultRates();
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ""} ${a} !== ${b}`);

  const strip = newElementItem(ELEMENT_TYPES.find((t) => t.id === "strip_footings"));
  strip.labourAuto = false; // materials only, so the expected rates are exact
  strip.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  strip.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  strip.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
  strip.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 10;            // 10 × 212.50 = 2,125
  strip.qtys[rateKey("PROCESSED BAR", "N12", "m")] = 400;          // 400 × 0.91kg = 0.364t × 1925 = 700.70
  const stripTotal = 2125 + 700.7;

  // No geometry recorded yet → only the concrete volume can be divided by
  assert.deepEqual(computeElementUnitRates(strip, rates).map((l) => l.unit), ["m³"], "no measures = just $/m³");

  // The Estimates Project Geometry table supplies the run (and footprint)
  strip.measureLm = 60;
  strip.measureM2 = 27;
  const lines = computeElementUnitRates(strip, rates);
  assert.deepEqual(lines.map((l) => l.unit), ["lm", "m²", "m³"], "fixed order lm → m² → m³");
  near(lines[0].rate, stripTotal / 60, "$/lm is the whole cost over the total strip length");
  near(lines[1].rate, stripTotal / 27, "$/m² is the whole cost over the measured area");
  near(lines[2].rate, stripTotal / 10, "$/m³ is the whole cost over the poured volume");
  assert.equal(lines[0].qty, 60);

  // Labour belongs in the numerator: the same element with the crew engine
  // on must price HIGHER per lineal metre, never lower.
  const withLabour = { ...strip, labourAuto: true };
  assert.ok(computeElementUnitRates(withLabour, rates)[0].rate > lines[0].rate, "rates are all-in, labour included");

  // An area-only element (a slab with no run recorded) skips the lm line
  const slab = newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground"));
  slab.labourAuto = false;
  slab.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  slab.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
  slab.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
  slab.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 20;
  slab.measureM2 = 180;
  assert.deepEqual(computeElementUnitRates(slab, rates).map((l) => l.unit), ["m²", "m³"], "slab shows m² then m³");
  near(computeElementUnitRates(slab, rates)[0].rate, (20 * 212.5) / 180);

  // Nothing entered at all → no rates, never a divide-by-zero
  assert.deepEqual(computeElementUnitRates(newElementItem(ELEMENT_TYPES[0]), rates), []);
});

check("Import: the Project Geometry table's runM/areaM2 land on the items and SUM when same-type elements combine", () => {
  const { quote } = buildImportFromEstimate({
    project: {},
    lines: [
      estLine({ category: "Strip Footing", element: "Strip A", elementId: "S1", material: "N25 concrete", finalQty: 6 }),
      estLine({ category: "Strip Footing", element: "Strip B", elementId: "S2", material: "N25 concrete", finalQty: 4 }),
      estLine({ category: "Slab on Ground", element: "GF Slab", elementId: "SL1", material: "N25 concrete", finalQty: 20 }),
    ],
    elementGeometry: { S1: { runM: 37.5, areaM2: 16.88 }, S2: { runM: 22.5, areaM2: 10.12 }, SL1: { runM: 0, areaM2: 180 } },
  });
  const strip = quote.items.find((it) => it.typeId === "strip_footings");
  assert.equal(strip.measureLm, 60, "the two strips' runs sum on the combined card");
  assert.equal(strip.measureM2, 27, "their areas sum too");
  const slab = quote.items.find((it) => /slab/i.test(it.typeId));
  assert.equal(slab.measureM2, 180);
  assert.equal(slab.measureLm, undefined, "a zero run is not recorded");
  // and the rates engine reads them straight off the imported item
  const l = computeElementUnitRates(strip, defaultRates());
  assert.equal(l[0].unit, "lm");
  assert.equal(l[0].qty, 60);

  // an export published before the geometry table existed still imports fine
  const { quote: legacy } = buildImportFromEstimate({
    project: {},
    lines: [estLine({ category: "Strip Footing", element: "Strip A", elementId: "S1", material: "N25 concrete", finalQty: 6 })],
  });
  assert.equal(legacy.items[0].measureLm, undefined);
  assert.equal(legacy.items[0].measureM2, undefined);
});

check("Geometry name-matching: a Quotes card sums EVERY takeoff element whose name matches it (all strips into one Strip Footings card)", () => {
  // instance numbers, plurals and the merge's "(x2 combined)" suffix all
  // reduce to the same key
  assert.equal(normalizeElementName("Strip Footing 2"), normalizeElementName("Strip Footings"));
  assert.equal(normalizeElementName("Strip Footings (×2 combined)"), normalizeElementName("Strip Footing"));
  assert.notEqual(normalizeElementName("Strip Footing"), normalizeElementName("Pad Footing"));

  const takeoff = [
    { name: "Strip Footing 1", runM: 37.5, areaM2: 16.88 },
    { name: "Strip Footing 2", runM: 22.5, areaM2: 10.12 },
    { name: "Slab on Ground 1", runM: 0, areaM2: 180 },
    { name: "Pad Footing 1", runM: 0, areaM2: 9 },
  ];
  const strips = geometryForLabel("Strip Footings", takeoff);
  assert.equal(strips.runM, 60, "the strips' runs sum — and ONLY the strips'");
  assert.equal(strips.areaM2, 27);
  assert.equal(strips.matched.length, 2);

  // a renamed card still matches: either name may contain the other
  assert.equal(geometryForLabel("Ground Floor - Slab on Ground", takeoff).areaM2, 180);
  // pads don't get dragged in by the footing word
  assert.equal(geometryForLabel("Pad Footings", takeoff).areaM2, 9);
  // nothing matching -> null, never a bogus zero
  assert.equal(geometryForLabel("Retaining Wall", takeoff), null);
  assert.equal(geometryForLabel("", takeoff), null);
});

check("Import keeps each takeoff element's geometry WITH its name, so Quotes can re-match after a rename", () => {
  const { quote } = buildImportFromEstimate({
    project: {},
    lines: [
      estLine({ category: "Strip Footing", element: "Strip Footing 1", elementId: "S1", material: "N25 concrete", finalQty: 6 }),
      estLine({ category: "Strip Footing", element: "Strip Footing 2", elementId: "S2", material: "N25 concrete", finalQty: 4 }),
    ],
    elementGeometry: { S1: { runM: 37.5, areaM2: 16.88 }, S2: { runM: 22.5, areaM2: 10.12 } },
  });
  assert.equal(quote.estimateGeometry.length, 2, "both takeoff elements are recorded by name");
  assert.deepEqual(quote.estimateGeometry.map((g) => g.name).sort(), ["Strip Footing 1", "Strip Footing 2"]);
  // renaming the merged card and re-matching still lands the full 60 lm
  const renamed = geometryForLabel("Ground Floor Strip Footings", quote.estimateGeometry);
  assert.equal(renamed.runM, 60);
});

check("Project unit rates: the whole quote's cost over the project's total run, area and concrete — including $/m³", () => {
  const rates = defaultRates();
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ""} ${a} !== ${b}`);
  const noFees = (it) => {
    it.labourAuto = false;
    it.qtys[rateKey("CONCRETE", "Minimum cartage (load under 4 m3)", "m3")] = 0;
  it.qtys[rateKey("CONCRETE", "Environment levy", "m3")] = 0;
    it.qtys[rateKey("CONCRETE", "Production & transport surcharge", "m3")] = 0;
    return it;
  };

  const strip = noFees(newElementItem(ELEMENT_TYPES.find((t) => t.id === "strip_footings")));
  strip.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 10;   // 2,125
  strip.measureLm = 60;

  const slab = noFees(newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground")));
  slab.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 20;    // 4,250
  slab.measureM2 = 250;

  const items = [strip, slab];
  const total = 2125 + 4250;
  const lines = computeProjectUnitRates(items, rates);
  assert.deepEqual(lines.map((l) => l.unit), ["lm", "m²", "m³"], "same fixed lm -> m² -> m³ order as a row");
  near(lines[0].rate, total / 60, "project $/lm over the project's total run");
  near(lines[1].rate, total / 250, "project $/m² over the project's total area");
  near(lines[2].rate, total / 30, "project $/m³ over ALL the project's concrete");
  assert.equal(lines[2].qty, 30, "the m³ total sums every element's concrete");

  // measures that nobody recorded simply don't appear
  const bare = noFees(newElementItem(ELEMENT_TYPES.find((t) => t.id === "slab_on_ground")));
  bare.qtys[rateKey("CONCRETE", "25 mpa", "m3")] = 5;
  assert.deepEqual(computeProjectUnitRates([bare], rates).map((l) => l.unit), ["m³"]);
  // an empty/zero-cost quote gives nothing rather than dividing by zero
  assert.deepEqual(computeProjectUnitRates([], rates), []);
});

console.log(`\n${passed} check(s) passed.`);
if (process.exitCode) {
  console.error("\nSome checks FAILED — see above.");
} else {
  console.log("All good.");
}
