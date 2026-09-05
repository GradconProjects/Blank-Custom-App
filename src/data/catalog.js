/**
 * BOMA ESTIMATES catalog data.
 *
 * Plain data only — no React, no side effects. This file (and lib/costing.js,
 * which consumes it) is deliberately kept importable by plain Node so the
 * costing logic can be unit-tested without a browser (see scripts/verify.mjs).
 *
 * See CLAUDE.md at the project root for the business rules this data
 * encodes before changing anything here.
 */

/* ---------- Resource / labour catalog ---------- */
// Crew-sheet columns, in the order they read on the paper labour sheet:
// the three 3+-person crews first, then plant, pump (hr AND m³ — distinct
// keys, see CLAUDE.md rule 5), crane. `crew: true` marks the minimum-crew
// columns; they count CREW-days (a whole crew booked for a day), so their
// rates are PER CREW: Concrete Crew 3 men, Steel Crew 5 men, General Labour
// 3 men. Plant stays per unit-day; pumping is $10/m³ plus $250/hr.
// The crew units are "crew-day" (not "day") ON PURPOSE: the per-crew rates
// replaced per-person rates saved in existing installs under the old
// name+"day" keys, and the changed unit retires those stale overrides —
// lookupRate falls back to these new catalog defaults (CLAUDE.md rule 6).
// A concrete order under this volume (per element/pour) attracts the
// catalog's "Minimum cartage" automatically — see autoMinimumCartage in
// lib/costing.js. Typed values on the Minimum cartage row always win.
//
// Holcim (Melbourne Metro & Mornington Peninsula) service-fee schedule,
// effective 1 May 2026: the fee applies where a DELIVERED LOAD is under
// 4.0 m³, and is charged on the undelivered part of that load — i.e.
// (4.0 - load) x $80/m³, per truck, not on the order total. An 11 m³ order
// delivered 7+4 attracts nothing; delivered 8+3 the second truck is 1 m³
// short, so $80. Quotes hold a total volume rather than a delivery
// schedule, so the engine splits it into whole truck loads of
// TRUCK_LOAD_M3 and charges the shortfall on the last (part) load — the
// realistic worst case. Both figures are editable (the truck size in the
// Rates modal, the $/m³ on the row itself), and typing a quantity on the
// row takes it fully manual for a known delivery split.
export const MIN_CARTAGE_THRESHOLD_M3 = 4;
// Kept as an alias so saved code/tests referring to the old name still read.
export const SMALL_LOAD_THRESHOLD_M3 = MIN_CARTAGE_THRESHOLD_M3;
export const TRUCK_LOAD_M3 = 8;

// Crew columns are priced PER PERSON per day ("man-day" unit — a fresh key
// that retires both the original per-person "day" overrides and the
// crew-era "crew-day" ones). Each crew-sheet ROW chooses its own mode:
// per-crew cells are crew-days costed as cells × that row's men-per-crew ×
// this man-day rate (row's men blank → the column's `men` default below);
// per-person cells are man-days costed directly. Defaults reproduce the
// old crew pricing exactly (3 × $500 = $1,500 concrete crew-day, 5 × $650
// = $3,250 steel crew-day, …).
export const RESOURCE_COLS = [
  { key: "concreter_day", name: "Concrete Crew", unit: "man-day", rate: 500, crew: true, men: 3 },
  { key: "steelfixer_day", name: "Steel Crew", unit: "man-day", rate: 650, crew: true, men: 5 },
  // Formwork crew-days are always entered MANUALLY — the engine never
  // auto-fills this column (propping effort varies too much by system).
  { key: "formwork_day", name: "Formwork Crew", unit: "man-day", rate: 500, crew: true, men: 3 },
  { key: "labourer_day", name: "General Labour Crew", unit: "man-day", rate: 400, crew: true, men: 3 },
  { key: "excavator_day", name: "Excavator", unit: "day", rate: 900 },
  { key: "bobcat_day", name: "Bobcat", unit: "day", rate: 900 },
  { key: "truck_day", name: "Trucks", unit: "day", rate: 900 },
  { key: "pump_hr", name: "Pump", unit: "hr", rate: 250 },
  { key: "pump_m3", name: "Pump", unit: "m³", rate: 10 },
  { key: "crane_day", name: "Crane", unit: "day", rate: 1600 },
  // Structural steel erection. These appear on every element's matrix like
  // every other resource (see CLAUDE.md rule 1 — the whole catalog shows
  // everywhere and a blank cell costs nothing); they only carry figures on
  // the steel element types.
  { key: "erector_day", name: "Steel Erection Crew", unit: "man-day", rate: 720, crew: true, men: 4 },
  { key: "welder_day", name: "Welder", unit: "man-day", rate: 780, crew: true, men: 1 },
  { key: "ewp_day", name: "EWP / Scissor Lift", unit: "day", rate: 420 },
];

/* ---------- Production rates ----------
 * Labour-productivity rates (hours per m³ / per tonne) used to suggest
 * — never force — labour hours in an element's Labour/Equipment matrix
 * from quantities already entered in its material rows. Mirrors Rates
 * Library's own concreteLabour.placingHrsPerM3/finishingHrsPerM3 and
 * steel fixingLabourHrsPerT fields (same real-world numbers), kept as
 * Quotes' own separate, independently-editable copy — Quotes has always
 * had its own rates system rather than reading Rates Library's live data,
 * see CLAUDE.md. Suggestions only ever fill a genuinely empty cell; see
 * suggestedLabourPrefill in lib/costing.js.
 */
// Crew-block rules: how much work ONE crew-day (or one plant-day) covers.
// The engine works in whole crews: the transferred quantity is rounded UP to
// a whole unit in the background (0.13 t books a full tonne's crew) and then
// to whole crew-days — the Qty column still DISPLAYS the true quantity.
// All editable in the Rates modal like every other rate.
export const PRODUCTION_RATES = [
  { key: "pour_m3_crewday", name: "Concrete pour — m³ per crew-day", unit: "m³/day", rate: 10 },
  { key: "steel_t_crewday", name: "Rebar fixing — tonnes per crew-day", unit: "t/day", rate: 1 },
  { key: "finish_m2_crewday", name: "Surface finishing — m² per crew-day", unit: "m²/day", rate: 300 },
  { key: "general_m3_crewday", name: "General labour — m³ per crew-day", unit: "m³/day", rate: 60 },
  // No formwork or excavation blocks: those crew/plant cells are NOT
  // auto-derived (propping effort varies by system, excavator days by ground
  // conditions) — entered manually, always. Their Qty columns still prefill.
  { key: "pump_hrs_pour", name: "Concrete pump — hours per pour", unit: "hrs", rate: 6 },
  // The agitator size the minimum-cartage split assumes — edit here if the
  // supplier runs smaller/larger trucks on a job.
  { key: "truck_load_m3", name: "Concrete truck load size", unit: "m³/load", rate: 8 },
  // Structural steel erection, tonnes stood per crew-day. Heavily
  // job-dependent (piece count matters far more than tonnage on light
  // framing), so it seeds a starting figure rather than a truth — edit it
  // per job in the Rates modal.
  { key: "erect_t_crewday", name: "Steel erection — tonnes per crew-day", unit: "t/day", rate: 4 },
];

/* ---------- Labour task templates, keyed by the element's `labour` field ---------- */
// ONE fixed crew-sheet task structure for every element type (matching the
// paper labour sheet: setup, excavate, tie, pour, finish, washout, plus two
// free additional rows). The template keys survive because every
// ELEMENT_TYPES entry references one. Elements saved before this change
// keep the task rows they were created with.
const CREW_SHEET_TASKS = [
  "Site setup / mobilisation",
  "Excavate & prepare base",
  "Tie reinforcement",
  "Pour / place / vibrate concrete",
  "Finish concrete surfaces",
  "Washout / clean / tidy",
  "Additional labour / plant",
  "Additional labour / plant",
];
/* The steel sequence has nothing in common with the concrete one — there is
   no pour, no finish and no washout, and bolt-up, welding and sheeting are
   each their own day's work. */
const STEEL_ERECTION_TASKS = [
  "Site setup / mobilisation",
  "Set out & survey",
  "Erect steel frame",
  "Bolt up, plumb & align",
  "Site welding",
  "Purlins, girts & bracing",
  "Roof & wall sheeting",
  "Touch-up & make good",
  "Additional labour / plant",
];

export const LABOUR_TEMPLATES = {
  excavation: CREW_SHEET_TASKS,
  footing: CREW_SHEET_TASKS,
  wall: CREW_SHEET_TASKS,
  slab_ground: CREW_SHEET_TASKS,
  slab_suspended: CREW_SHEET_TASKS,
  stairs: CREW_SHEET_TASKS,
  steel: STEEL_ERECTION_TASKS,
};

/* ---------- Full material catalog ----------
 * weightBasis: true means Total Cost = (Qty * Unit Weight / 1000) * Unit Cost
 *              (Unit Cost is $/tonne). Only PROCESSED BAR is genuinely
 *              priced this way in the supplier pricing.
 * areaBasis: true means Qty is entered in m² of coverage and Total Cost =
 *            ceil(Qty / Sheet Area) * Unit Cost (Unit Cost is $/sheet).
 *            Only SQUARE MESH works this way — sheets are bought whole, so
 *            the estimator enters the area to cover and the tool works out
 *            how many sheets that requires, rather than making them count
 *            sheets by hand.
 * weightBasis: false, areaBasis: false (the default) means Total Cost =
 *              Qty * Unit Cost, even for products that also carry a Unit
 *              Weight for informational tonnage (Trench Mesh is priced per
 *              length, not per tonne).
 * lengthBasis: true means Qty is entered in metres of bar needed and Total
 *              Cost = ceil(Qty / Bar Length) * Unit Cost (Unit Cost is
 *              $/bar, Bar Length is the fixed stock length in metres —
 *              6.0m for every current STOCK BAR product). Only STOCK BAR
 *              works this way — bars are bought as whole fixed-length
 *              sticks, so the estimator enters the run of metres needed and
 *              the tool works out how many whole bars that requires, the
 *              same idea as areaBasis/SQUARE MESH but by length instead of
 *              area.
 * See CLAUDE.md → "Costing rules" before changing any of these flags on any
 * category, and lib/costing.js → computeRowTotal, the ONE place that
 * implements this — never recompute a row total inline elsewhere.
 */
export const FULL_CATALOG = [
  { key: "TRENCH MESH", weightBasis: false, products: [
    ["3 Bar-L8TM", "length", 6.8, 14.39], ["4 Bar-L8TM", "length", 9.2, 18.58], ["5 Bar-L8TM", "length", 11.6, 25.87], ["6 Bar-L8TM", "length", 13.9, 31.05],
    ["3 Bar-L11TM", "length", 13.3, 24.43], ["4 Bar-L11TM", "length", 17.7, 33.79], ["5 Bar-L11TM", "length", 22.3, 41.3], ["6 Bar-L11TM", "length", 26.8, 50.66],
    ["3 Bar-L12TM", "length", 16.3, 30.07], ["4 Bar-L12TM", "length", 21.8, 41.19], ["5 Bar-L12TM", "length", 27.3, 50.66], ["6 Bar-L12TM", "length", 32.8, 61.84], ["7 Bar-L12TM", "length", 38.75, 103.5],
    ["3 Bar-L16TM", "length", 28.9, 91.08], ["4 Bar-L16TM", "length", 38.5, 92.89],
  ]},
  /* areaBasis: qty is entered in m² of coverage, not sheet count — a
   * standard AU mesh sheet is 6.0m x 2.4m = 14.4m², so cost is
   * ceil(qty / sheetArea) * unitCost (you can't buy a fraction of a
   * sheet). unitCost is still genuinely $/sheet. See computeRowTotal in
   * lib/costing.js — this mirrors the weightBasis pattern (Processed Bar)
   * but converts by sheet coverage instead of by weight. */
  { key: "SQUARE MESH", weightBasis: false, areaBasis: true, products: [
    ["SL52", "m2", 21, 50.64, 14.4], ["SL62", "m2", 33, 61.84, 14.4], ["SL72", "m2", 41, 74.62, 14.4], ["SL82", "m2", 52, 98.12, 14.4], ["SL92", "m2", 66, 116.54, 14.4],
    ["SL102", "m2", 80, 141.18, 14.4], ["SL81", "m2", 105, 185.27, 14.4], ["RL718", "m2", 67, 168.71, 14.4], ["RL818", "m2", 79, 196, 14.4], ["RL918", "m2", 93, 230.73, 14.4],
    ["RL1018", "m2", 109, 255.85, 14.4], ["RL1118", "m2", 130.53, 231.12, 14.4], ["RL1218", "m2", 157, 328.1, 14.4],
  ]},
  // Stock Bar's unitCost is derived from a flat $1825/tonne (BOMA_STOCK_BAR_RATE_PER_TONNE)
  // × each bar's own unitWeight — same "one real steel rate, converted per product" approach
  // Processed Bar already uses below. It's still priced $/bar (lengthBasis), not by weight —
  // see rule 2 in CLAUDE.md — this only changes where the $/bar number comes from.
  { key: "STOCK BAR", weightBasis: false, lengthBasis: true, products: [
    ["N10 Ligatures - 6.0m length", "m", 3.79, 6.92, null, 6],
    ["N12 - 6.0m length", "m", 5.46, 9.96, null, 6], ["N16 - 6.0m length", "m", 9.6, 17.52, null, 6], ["N20 - 6.0m length", "m", 15.19, 27.72, null, 6],
    ["N24 - 6.0m length", "m", 21.83, 39.84, null, 6], ["N28 - 6.0m length", "m", 29.71, 54.22, null, 6], ["N32 - 6.0m length", "m", 38.81, 70.83, null, 6],
  ]},
  // Uniform $1925/tonne (BOMA_PROCESSED_BAR_RATE_PER_TONNE, matching Rates Library's own
  // constant) across every diameter — Processed Bar has always been priced this way, a single
  // flat mill rate rather than a per-diameter price.
  { key: "PROCESSED BAR", label: "PROCESSED BAR (unit cost $/tonne, applied to Total Weight)", weightBasis: true, products: [
    ["N10", "m", 0.632, 1925], ["N12", "m", 0.91, 1925], ["N16", "m", 1.6, 1925], ["N20", "m", 2.532, 1925], ["N24", "m", 3.639, 1925],
    ["N28", "m", 4.951, 1925], ["N32", "m", 6.468, 1925], ["N36", "m", 8.19, 1925], ["N40", "m", 10.107, 1925],
    // Rate-based reinforcement: instead of taking off every bar, the estimator
    // sets a kg/m³ rate on the element (the usual early-stage rule of thumb —
    // ~90 kg/m³ for a suspended slab, ~150 for columns) and the tonnage is
    // derived from that element's poured volume. Qty here is TONNES, priced at
    // the same $/tonne as every other processed bar; unitWeight is null so
    // computeRowTotal's weightBasis branch is skipped and it costs as
    // qty * unitCost. Filled in automatically by autoReinforcementByRate —
    // see costing.js — and dormant until an element carries a kg/m³ rate.
    ["Reinforcement by rate", "t", null, 1925],
  ]},
  { key: "REINFORCING ACCESSORIES", weightBasis: false, products: [
    ["Delivery fee", "each", null, 300], ["Poly", "roll", null, 89.4],
    // Same product Poly already covers (a roll of polythene sheeting), but named explicitly so
    // it's findable by name rather than only recognisable to someone who already knows "Poly" is
    // it — kept as a SEPARATE product rather than renaming Poly, since Poly is an existing,
    // rateKey-identified product a live quote could already have a quantity saved against;
    // renaming it would silently orphan that entry from the UI (see CLAUDE.md rule 6).
    ["Vapour Barrier / DPM membrane", "m2", null, 2.5],
    ["Duct Tape", "roll", null, 4.5], ["Abelflex 100mm", "roll", null, 36],
    ["Abelflex 150mm", "roll", null, 54], ["CP 25/40 Bar chairs", "bag", null, 16.2], ["CP 50/65 Bar chairs", "bag", null, 17.4],
    ["CP 75/90 Bar chairs", "bag", null, 21], ["CP 85/100 Bar chairs", "bag", null, 24], ["BCPT 30 Bar chairs", "bag", null, 19.2],
    ["BCPT 100 Bar chairs", "bag", null, 45.6], ["Base 152", "bag", null, 36.6], ["BP1.6 Tie wire", "roll", null, 5.15],
  ]},
  { key: "CONCRETE", weightBasis: false, products: [
    ["25 mpa Agilia", "m3", null, 310.5], ["32 mpa Agilia", "m3", null, 322.5], ["40 mpa Agilia", "m3", null, 334.5], ["40 mpa Agilia (walls)", "m3", null, 342.5],
    ["15 mpa", "m3", null, 196.5], ["20 mpa", "m3", null, 207.5], ["25 mpa", "m3", null, 212.5], ["32 mpa", "m3", null, 221.5], ["40 mpa", "m3", null, 233.5],
    ["50 mpa", "m3", null, 252.5], ["Exposed Agg", "m3", null, 400],
    // Holcim service fees. Minimum cartage is $/m³ SHORT of a 4 m³ load (see
    // MIN_CARTAGE_THRESHOLD_M3); the levy and surcharge are $/m³ delivered.
    ["Minimum cartage (load under 4 m3)", "m3", null, 80],
    ["Production & transport surcharge", "m3", null, 9.17],
    ["Environment levy", "m3", null, 2.8],
    ["Penetron (Xypex) additive", "m3", null, 100],
    // Blinding is normally a low-strength unreinforced mix — seeded at the same rate as 15 mpa
    // (the lowest plain mix already in this catalog) rather than inventing a new price point.
    ["Blinding concrete", "m3", null, 196.5],
  ]},
  /* J. King concrete pumping schedule. `minQty` is the contract MINIMUM
   * billed quantity — a 4-hour-minimum pump costs 4 hours even if it's on
   * site for one, so computeRowTotal bills max(qty, minQty). Every rate and
   * every minimum is editable in the Rates modal like any other product.
   * The two "quote only" lines carry no rate: price them from the supplier's
   * quote by typing the total on the row. */
  { key: "CONCRETE PUMPING", weightBasis: false, products: [
    ["Line pump — up to 70m of line (4 hr min)", "hr", null, 200, null, null, 4],
    ["Line pump — 70-90m of line (4 hr min)", "hr", null, 240, null, null, 4],
    ["Line pump — over 90m of line (quote only)", "quote", null, 0],
    ["Boom pump — 28-32m boom (4 hr min)", "hr", null, 220, null, null, 4],
    ["Boom pump — 37m boom (4 hr min)", "hr", null, 230, null, null, 4],
    ["Boom pump — 42m boom (4 hr min)", "hr", null, 240, null, null, 4],
    ["Boom pump — 47m boom and above (quote only)", "quote", null, 0],
    ["Travel charge (1 hr min, at the pump's hourly rate)", "hr", null, 220, null, null, 1],
    ["Pumped volume", "m3", null, 10],
    ["Washout bag", "each", null, 200],
    ["Offsite washout", "each", null, 250],
    ["Extra labourer / hose hand (6 hr min)", "hr", null, 100, null, null, 6],
    ["Saturday work (6 hr min, at the pump's hourly rate)", "hr", null, 220, null, null, 6],
    ["Cancellation (5 hr min, at the pump's hourly rate)", "hr", null, 220, null, null, 5],
  ]},
  { key: "RATE ITEMS", weightBasis: false, products: [
    ["Hobbs", "m", null, 105], ["Plinths", "m2", null, 610], ["0-50mm set downs", "m", null, 20], ["51-100mm set downs", "m", null, 45],
    ["101mm-150mm setdown", "m", null, 80], ["Steps", "m", null, 200], ["Screeds", "m2", null, 120], ["Screeds (decorative)", "m2", null, 140],
    ["Insitu Walls", "m2", null, 760], ["Stair (floor-floor)", "l/m risers", null, 682], ["Shotcrete", "m2", null, 300],
  ]},
  { key: "FORMWORK", weightBasis: false, products: [
    ["Material", "unit", null, 400], ["Conventional", "m2", null, 60], ["Bondek", "m2", null, 125], ["Edgeform", "m", null, 8],
    ["Beam/fold sides <400mm d", "m", null, 100], ["Beam/fold sides >400mm d", "m2", null, 250], ["Handrail", "m", null, 30],
    ["Walls", "m2", null, 250], ["Walls Curved", "m2", null, 350], ["Columns (eg 300x300)", "each", null, 1000],
    ["Oregon boards", "m2", null, 125], ["Crane Truck hire", "each", null, 1500], ["Scaffold Hire", "day", null, 175], ["Certification", "each", null, 400],
  ]},
  // Specified insulation products (under-slab, slab edge, thermal break) —
  // the estimator picks the actual material/thickness/R-value, not a generic
  // "Insulation" line. Prices are catalog seeds, editable in the Rates modal
  // like everything else. The old generic "Insulation" row stays in OTHER
  // ACCESSORIES below because its rateKey may already carry quantities in
  // saved quotes — removing/renaming it would silently drop those from totals.
  { key: "INSULATION", weightBasis: false, products: [
    ["Kooltherm K3 Floorboard 50mm (R2.25)", "m2", null, 42],
    ["Kooltherm K3 Floorboard 60mm (R2.70)", "m2", null, 50],
    ["XPS rigid board 30mm (R0.88)", "m2", null, 18],
    ["XPS rigid board 50mm (R1.47)", "m2", null, 26],
    ["EPS board M-grade 50mm (R1.19)", "m2", null, 12],
    ["EPS board M-grade 75mm (R1.79)", "m2", null, 16],
    ["Foilboard rigid panel 25mm", "m2", null, 15],
    ["Slab edge insulation — 30mm XPS 300mm strip", "m", null, 9],
    ["Thermal break strip 10mm", "m", null, 6],
    ["Insulation (other — specify in description)", "m2", null, 25],
  ]},
  { key: "OTHER ACCESSORIES", weightBasis: false, products: [
    // Vapour barrier is its own product, DISTINCT from Insulation — a 200µm
    // poly membrane per m² laid, not an insulation board/strip.
    ["Packing sand", "m3", null, 50], ["Crushed Rock", "m3", null, 63], ["Insulation", "m2", null, 25], ["Vapour barrier", "m2", null, 3], ["Epoxy", "unit", null, 70],
    ["Marking Paint", "unit", null, 4], ["Sealers/Acid/MBT", "each", null, 400], ["Curing Products", "price", null, 100],
  ]},
  { key: "OTHER ALLOWANCES", weightBasis: false, products: [
    ["Inspector", "each", null, 130], ["Soil removal", "m3", null, 40], ["Bin Hire", "each", null, 600], ["Sawcutting", "day", null, 450],
    ["Concrete test", "each", null, 241.5], ["Off-site washout fee", "each", null, 400], ["Truck washout fee", "each", null, 10.5],
  ]},
  // ---------------------------------------------------------------------
  // STRUCTURAL STEEL
  //
  // Unit weights below are the real AS/NZS designated masses (a 310UB40.4 is
  // 40.4 kg/m by definition), so the tonnage the tool reports is the tonnage
  // the fabricator will invoice against.
  //
  // The section categories are weightBasis: true — Qty is METRES, unitCost is
  // $/tonne, and computeRowTotal turns one into the other. That is the same
  // rule PROCESSED BAR follows and the same reason: steel is bought and
  // fabricated by weight but measured off drawings by length. Everything else
  // here (purlins, sheeting, connections, treatment) is priced per its own
  // unit and stays weightBasis: false, exactly like Trench Mesh — several
  // still carry a unitWeight purely so the UI can show informational tonnage
  // for crane and transport planning. See CLAUDE.md -> "Costing rules" rule 2
  // before changing any of these flags.
  // ---------------------------------------------------------------------
  { key: "STEEL SECTIONS — BEAMS & COLUMNS", label: "STEEL SECTIONS — BEAMS & COLUMNS (unit cost $/tonne, applied to Total Weight)", weightBasis: true, products: [
    ["150UB14.0", "m", 14.0, 5200], ["200UB25.4", "m", 25.4, 5200], ["250UB31.4", "m", 31.4, 5200],
    ["310UB40.4", "m", 40.4, 5200], ["360UB50.7", "m", 50.7, 5200], ["410UB53.7", "m", 53.7, 5200],
    ["460UB74.6", "m", 74.6, 5200], ["530UB82.0", "m", 82.0, 5200], ["610UB101", "m", 101.0, 5200],
    ["100UC14.8", "m", 14.8, 5200], ["150UC23.4", "m", 23.4, 5200], ["200UC46.2", "m", 46.2, 5200],
    ["250UC72.9", "m", 72.9, 5200], ["310UC96.8", "m", 96.8, 5200],
    ["150PFC17.7", "m", 17.7, 5350], ["200PFC22.9", "m", 22.9, 5350], ["250PFC35.5", "m", 35.5, 5350],
    ["300PFC40.1", "m", 40.1, 5350], ["380PFC55.2", "m", 55.2, 5350],
  ]},
  { key: "STEEL SECTIONS — HOLLOW & ANGLE", label: "STEEL SECTIONS — HOLLOW & ANGLE (unit cost $/tonne, applied to Total Weight)", weightBasis: true, products: [
    ["SHS 65x65x4", "m", 7.31, 5900], ["SHS 89x89x5", "m", 12.8, 5900], ["SHS 100x100x5", "m", 14.5, 5900],
    ["SHS 125x125x6", "m", 21.9, 5900], ["SHS 150x150x6", "m", 26.6, 5900], ["SHS 200x200x9", "m", 52.9, 5900],
    ["RHS 100x50x4", "m", 8.7, 5900], ["RHS 150x50x5", "m", 14.4, 5900], ["RHS 200x100x6", "m", 26.4, 5900],
    ["RHS 250x150x9", "m", 52.0, 5900],
    ["CHS 88.9x4.0", "m", 8.38, 6200], ["CHS 114.3x4.8", "m", 13.0, 6200], ["CHS 168.3x5.0", "m", 20.1, 6200],
    ["CHS 219.1x6.4", "m", 33.6, 6200],
    ["EA 50x50x5", "m", 3.71, 5500], ["EA 75x75x6", "m", 6.67, 5500], ["EA 100x100x8", "m", 11.8, 5500],
    ["EA 125x125x10", "m", 18.6, 5500],
    ["Plate / flat bar", "kg", 1.0, 5.6],
  ]},
  { key: "STEEL FRAMING — PORTALS, TRUSSES & BRACING", weightBasis: false, products: [
    // Fabricated assemblies: priced per tonne of finished frame (Qty is
    // tonnes, so no weightBasis conversion), or per item where the trade
    // quotes them that way.
    ["Portal frame — supply & fabricate", "t", null, 5400],
    ["Roof truss — supply & fabricate", "t", null, 5800],
    ["Lattice / space truss — supply & fabricate", "t", null, 6400],
    ["Rafter / apex haunch", "each", null, 620],
    ["Knee haunch", "each", null, 540],
    ["Cross bracing — rod & turnbuckle", "m", 1.58, 46],
    ["Cross bracing — angle", "m", 6.67, 58],
    ["Fly brace", "each", null, 42],
    ["Mezzanine framing — supply & fabricate", "t", null, 5600],
  ]},
  { key: "STEEL PURLINS & GIRTS", weightBasis: false, products: [
    // Lysaght C and Z designated masses; priced per metre the way the
    // supplier quotes them, not per tonne.
    ["C15015 purlin/girt", "m", 2.54, 17.4], ["C15019 purlin/girt", "m", 3.14, 20.9],
    ["C20015 purlin/girt", "m", 3.35, 21.8], ["C20019 purlin/girt", "m", 4.18, 26.4],
    ["C25019 purlin/girt", "m", 5.13, 31.6], ["C25024 purlin/girt", "m", 6.36, 38.5],
    ["C30024 purlin/girt", "m", 7.61, 45.2], ["C35030 purlin/girt", "m", 11.0, 63.8],
    ["Z15015 purlin/girt", "m", 2.54, 17.9], ["Z20015 purlin/girt", "m", 3.35, 22.4],
    ["Z25019 purlin/girt", "m", 5.13, 32.4], ["Z30024 purlin/girt", "m", 7.61, 46.1],
    ["Purlin bridging / strut", "m", 1.72, 14.6],
    ["Purlin cleat", "each", null, 18.5],
    ["Purlin bolt M12 + nut", "each", null, 2.4],
  ]},
  { key: "ROOF & WALL CLADDING", weightBasis: false, products: [
    ["Corrugated roof sheeting 0.42 BMT", "m2", 4.3, 29.5],
    ["Corrugated roof sheeting 0.48 BMT", "m2", 4.9, 34.2],
    ["Trimdek / monoclad 0.42 BMT", "m2", 4.5, 31.8],
    ["Trimdek / monoclad 0.48 BMT", "m2", 5.1, 36.4],
    ["Klip-lok concealed-fix 0.48 BMT", "m2", 5.2, 46.8],
    ["Wall cladding — corrugated 0.42 BMT", "m2", 4.3, 28.6],
    ["Insulated sandwich panel 50mm", "m2", 9.8, 118],
    ["Anticon roof blanket R1.3", "m2", null, 12.4],
    ["Roof safety mesh", "m2", null, 6.8],
    ["Translucent sheeting", "m2", null, 62],
    ["Ridge capping", "m", null, 34],
    ["Barge / gable flashing", "m", null, 31],
    ["Wall / apron flashing", "m", null, 28],
    ["Box gutter", "m", null, 96],
    ["Eaves gutter", "m", null, 44],
    ["Downpipe", "m", null, 36],
    ["Rainwater head / sump", "each", null, 185],
    ["Roof sheeting screws & seals", "m2", null, 3.2],
    ["Whirlybird / roof vent", "each", null, 240],
  ]},
  { key: "STEEL CONNECTIONS & JOINT DETAILS", weightBasis: false, products: [
    // Priced how a fabricator actually quotes connections: the plate work per
    // item, the bolts per bolt, and site welding per metre of run at the
    // specified leg size.
    ["Base plate — light (up to 12mm)", "each", 14, 165],
    ["Base plate — medium (16-20mm)", "each", 32, 285],
    ["Base plate — heavy (25mm+)", "each", 64, 495],
    ["Cap plate", "each", 11, 140],
    ["Web side plate / shear cleat", "each", 6, 96],
    ["Flexible end plate", "each", 9, 128],
    ["Bolted moment end plate", "each", 38, 420],
    ["Splice plate set — column", "set", 46, 560],
    ["Splice plate set — beam", "set", 34, 445],
    ["Web / load-bearing stiffener", "each", 5, 88],
    ["Gusset plate — bracing", "each", 12, 155],
    ["Seating cleat / angle cleat", "each", 4, 72],
    ["Holding-down bolt cage (4 bolt)", "each", 18, 320],
    ["HD bolt M20 cast-in", "each", 1.6, 19.5],
    ["HD bolt M24 cast-in", "each", 2.6, 29],
    ["Chemical anchor M16", "each", null, 16.5],
    ["Chemical anchor M20", "each", null, 24],
    ["Structural bolt M16 8.8/S", "each", null, 3.4],
    ["Structural bolt M20 8.8/S", "each", null, 4.6],
    ["Structural bolt M24 8.8/TB", "each", null, 8.9],
    ["Structural bolt M30 8.8/TB", "each", null, 17.5],
    ["Site weld — 6mm fillet", "m", null, 46],
    ["Site weld — 8mm fillet", "m", null, 64],
    ["Site weld — 10mm fillet", "m", null, 88],
    ["Site weld — full penetration butt", "m", null, 165],
    ["Shear stud 19mm — welded", "each", null, 4.8],
    ["Base plate grout — cementitious", "each", null, 58],
    ["Shim pack", "each", null, 12],
    ["Weld inspection / NDT", "each", null, 145],
  ]},
  { key: "STEEL PROTECTIVE TREATMENT", weightBasis: false, products: [
    ["Hot dip galvanising", "t", null, 1150],
    ["Shop primer", "m2", null, 14.5],
    ["Two-pack epoxy — shop applied", "m2", null, 38],
    ["Intumescent fire rating -/60/60", "m2", null, 68],
    ["Intumescent fire rating -/120/120", "m2", null, 112],
    ["Site touch-up & make good", "each", null, 26],
  ]},
  { key: "SUB CONTRACTORS / TEMPORARY WORKS", weightBasis: false, products: [
    ["Excavation (subcontract)", "quote", null, null], ["Formwork (subcontract)", "quote", null, null], ["Steel supply", "quote", null, null], ["Steel fix", "quote", null, null],
    ["Screw Piling", "quote", null, null], ["CFA Piling", "quote", null, null],
    // Bored piers: the DRILLING is a subcontract quote item — the pier's own
    // concrete and reinforcement stay priced from their normal categories.
    ["Bored Piers (subcontract)", "quote", null, null],
    ["Temporary steel props/struts (150UC23.4) — supply/hire", "tonne", null, 3200],
  ]},
].map((c) => ({
  ...c,
  label: c.label || c.key,
  products: c.products.map(([name, unit, unitWeight, unitCost, sheetArea, barLength, minQty]) => ({ name, unit, unitWeight, unitCost, sheetArea, barLength, minQty })),
}));

/* ---------- Element types ----------
 * Every concrete/structural element BOMA ESTIMATES might reasonably meet across
 * ANY building or civil project — not curated per job. `category` is the
 * broad, foldable grouping (Foundations, Suspended Structure, ...) shown
 * on the Add-Element dropdown; `section` is the finer sub-group used by
 * the Quote Summary rail. Keep the array in roughly ground-up construction
 * order (earthworks → foundations → retention → substructure → vertical
 * structure → suspended structure → external/landscape → pool → civil)
 * since that's meaningful to an estimator scanning the list, not
 * arbitrary. See CLAUDE.md → "How to extend" before adding to this list.
 */
export const ELEMENT_TYPES = [
  // Earthworks — standalone excavation/backfill, not bundled into a pour's labour tasks.
  { id: "excavation_bulk", category: "EARTHWORKS", section: "EXCAVATION", name: "Bulk Excavation", labour: "excavation" },
  { id: "excavation_trench", category: "EARTHWORKS", section: "EXCAVATION", name: "Trench Excavation", labour: "excavation" },
  { id: "excavation_rock", category: "EARTHWORKS", section: "EXCAVATION", name: "Rock Excavation / Breaking", labour: "excavation" },
  { id: "backfill_compaction", category: "EARTHWORKS", section: "EXCAVATION", name: "Backfill & Compaction", labour: "excavation" },

  // Foundations — piers/piles and footings that carry the structure to ground.
  { id: "piles_bored", category: "FOUNDATIONS", section: "PILING & PIERS", name: "Piles - Bored Piers", labour: "footing" },
  { id: "piles_driven", category: "FOUNDATIONS", section: "PILING & PIERS", name: "Driven Piles", labour: "footing" },
  { id: "piles_cfa", category: "FOUNDATIONS", section: "PILING & PIERS", name: "CFA Piles", labour: "footing" },
  { id: "screw_piles", category: "FOUNDATIONS", section: "PILING & PIERS", name: "Screw Piles", labour: "footing" },
  { id: "pile_caps_pad", category: "FOUNDATIONS", section: "FOOTINGS", name: "Pile Caps - Pad Footings", labour: "footing" },
  { id: "stump_footings", category: "FOUNDATIONS", section: "FOOTINGS", name: "Stump Footings", labour: "footing" },
  { id: "strip_footings", category: "FOUNDATIONS", section: "FOOTINGS", name: "Strip Footings", labour: "footing" },
  { id: "raft_foundation", category: "FOUNDATIONS", section: "FOOTINGS", name: "Raft / Mat Foundation", labour: "slab_ground" },
  { id: "capping_beam", category: "FOUNDATIONS", section: "FOOTINGS", name: "Capping Beam", labour: "footing" },
  { id: "edge_beam", category: "FOUNDATIONS", section: "FOOTINGS", name: "Edge Beam", labour: "footing" },
  { id: "internal_beam", category: "FOUNDATIONS", section: "FOOTINGS", name: "Internal Beam", labour: "footing" },
  { id: "column_base_plate", category: "FOUNDATIONS", section: "FOOTINGS", name: "Column Base Plate / Grout Pad", labour: "footing" },

  // Retention & temporary works — holds ground/excavations back during and after construction.
  { id: "anchor_block_strut", category: "RETENTION & TEMPORARY WORKS", section: "TEMPORARY PROPPING", name: "Anchor Block & Strut", labour: "footing" },
  { id: "shotcrete_wall", category: "RETENTION & TEMPORARY WORKS", section: "RETENTION SYSTEMS", name: "Shotcrete Retention Wall", labour: "wall" },
  { id: "secant_pile_wall", category: "RETENTION & TEMPORARY WORKS", section: "RETENTION SYSTEMS", name: "Secant / Contiguous Pile Wall", labour: "wall" },
  { id: "soldier_pile_wall", category: "RETENTION & TEMPORARY WORKS", section: "RETENTION SYSTEMS", name: "Soldier Pile Wall", labour: "wall" },
  { id: "retaining_wall", category: "RETENTION & TEMPORARY WORKS", section: "RETENTION SYSTEMS", name: "Basement - Retaining Wall", labour: "wall" },

  // Substructure — ground-bearing slabs below or at the lowest level.
  { id: "slab_on_ground", category: "SUBSTRUCTURE", section: "GROUND-BEARING SLABS", name: "Slab on Ground (Garage / Tennis Court / Plant Room / Hardstand)", labour: "slab_ground" },
  { id: "basement_slab", category: "SUBSTRUCTURE", section: "GROUND-BEARING SLABS", name: "Basement Slab", labour: "slab_ground" },
  { id: "ramp", category: "SUBSTRUCTURE", section: "GROUND-BEARING SLABS", name: "Ramp", labour: "slab_ground" },

  // Vertical structure — columns and load-bearing/core walls carrying floors above.
  { id: "rc_columns", category: "VERTICAL STRUCTURE", section: "COLUMNS", name: "RC Columns - Fence Post Columns", labour: "footing" },
  { id: "core_shear_wall", category: "VERTICAL STRUCTURE", section: "WALLS", name: "Core / Shear Wall", labour: "wall" },
  { id: "loadbearing_wall", category: "VERTICAL STRUCTURE", section: "WALLS", name: "Load-Bearing Wall", labour: "wall" },

  // Suspended structure — elevated slabs/beams, deliberately separate from Foundations.
  { id: "suspended_beam", category: "SUSPENDED STRUCTURE", section: "SUSPENDED BEAMS", name: "Suspended Beam", labour: "slab_suspended" },
  { id: "suspended_slab", category: "SUSPENDED STRUCTURE", section: "SUSPENDED SLABS", name: "Suspended Slab", labour: "slab_suspended" },
  { id: "transfer_slab_beam", category: "SUSPENDED STRUCTURE", section: "SUSPENDED SLABS", name: "Transfer Slab / Beam", labour: "slab_suspended" },
  { id: "post_tensioned_slab", category: "SUSPENDED STRUCTURE", section: "SUSPENDED SLABS", name: "Post-Tensioned Slab", labour: "slab_suspended" },
  // Its own labour template (stepped riser/tread formwork, not a flat soffit — see
  // LABOUR_TEMPLATES.stairs) and its own section, since a staircase isn't really a
  // suspended slab even though it's typically propped/formed the same way.
  // ---- STRUCTURAL STEEL: the superstructure that lands on the concrete,
  //      so it sits between the suspended structure and the external works
  //      in the ground-up order the dropdown and Quote Summary read in. ----
  { id: "steel_column", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Steel Column", labour: "steel" },
  { id: "steel_beam", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Steel Beam", labour: "steel" },
  { id: "portal_frame", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Portal Frame", labour: "steel" },
  { id: "roof_truss", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Roof Truss", labour: "steel" },
  { id: "steel_bracing", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Bracing - Roof & Wall", labour: "steel" },
  { id: "mezzanine_floor", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Mezzanine Floor Framing", labour: "steel" },
  { id: "composite_floor_deck", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Composite Floor Deck", labour: "steel" },
  { id: "steel_stair", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Steel Stair & Landing", labour: "steel" },
  { id: "steel_balustrade", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Handrail & Balustrade", labour: "steel" },
  { id: "steel_lintel", category: "STRUCTURAL STEEL", section: "STEEL FRAMING", name: "Steel Lintel", labour: "steel" },
  { id: "roof_purlins", category: "STRUCTURAL STEEL", section: "STEEL ROOFING & CLADDING", name: "Roof Purlins", labour: "steel" },
  { id: "wall_girts", category: "STRUCTURAL STEEL", section: "STEEL ROOFING & CLADDING", name: "Wall Girts", labour: "steel" },
  { id: "roof_sheeting", category: "STRUCTURAL STEEL", section: "STEEL ROOFING & CLADDING", name: "Roof Sheeting", labour: "steel" },
  { id: "wall_cladding", category: "STRUCTURAL STEEL", section: "STEEL ROOFING & CLADDING", name: "Wall Cladding", labour: "steel" },
  { id: "roof_flashings", category: "STRUCTURAL STEEL", section: "STEEL ROOFING & CLADDING", name: "Flashings & Cappings", labour: "steel" },
  { id: "roof_drainage", category: "STRUCTURAL STEEL", section: "STEEL ROOFING & CLADDING", name: "Gutters & Downpipes", labour: "steel" },
  { id: "steel_base_connection", category: "STRUCTURAL STEEL", section: "STEEL CONNECTIONS", name: "Base Plate & Holding-Down Set", labour: "steel" },
  { id: "steel_moment_connection", category: "STRUCTURAL STEEL", section: "STEEL CONNECTIONS", name: "Moment Connection", labour: "steel" },
  { id: "steel_shear_connection", category: "STRUCTURAL STEEL", section: "STEEL CONNECTIONS", name: "Shear / Cleat Connection", labour: "steel" },
  { id: "steel_splice", category: "STRUCTURAL STEEL", section: "STEEL CONNECTIONS", name: "Column / Beam Splice", labour: "steel" },
  { id: "steel_protective", category: "STRUCTURAL STEEL", section: "STEEL CONNECTIONS", name: "Galvanising & Fire Protection", labour: "steel" },

  { id: "staircase", category: "SUSPENDED STRUCTURE", section: "STAIRS", name: "Staircase", labour: "stairs" },

  // External & landscape concrete — outside the building envelope.
  { id: "planter_wall", category: "EXTERNAL & LANDSCAPE CONCRETE", section: "BOUNDARY & LANDSCAPE WALLS", name: "Planter Wall", labour: "wall" },
  { id: "boundary_wall", category: "EXTERNAL & LANDSCAPE CONCRETE", section: "BOUNDARY & LANDSCAPE WALLS", name: "Boundary Wall", labour: "wall" },
  { id: "retaining_wall_landscape", category: "EXTERNAL & LANDSCAPE CONCRETE", section: "BOUNDARY & LANDSCAPE WALLS", name: "Retaining Wall (Landscape)", labour: "wall" },
  { id: "driveway_hardstand", category: "EXTERNAL & LANDSCAPE CONCRETE", section: "PAVING & HARDSTAND", name: "Driveway / External Hardstand", labour: "slab_ground" },
  { id: "paths_paving", category: "EXTERNAL & LANDSCAPE CONCRETE", section: "PAVING & HARDSTAND", name: "Paths & Paving", labour: "slab_ground" },
  { id: "kerbs_channels", category: "EXTERNAL & LANDSCAPE CONCRETE", section: "PAVING & HARDSTAND", name: "Kerbs & Channels", labour: "footing" },

  // Pool construction.
  { id: "pool_wall", category: "POOL CONSTRUCTION", section: "POOL CONSTRUCTION", name: "Pool Wall", labour: "wall" },
  { id: "pool_slab", category: "POOL CONSTRUCTION", section: "POOL CONSTRUCTION", name: "Pool Slab", labour: "slab_ground" },
  { id: "spa_water_feature", category: "POOL CONSTRUCTION", section: "POOL CONSTRUCTION", name: "Spa / Water Feature", labour: "wall" },

  // Civil & infrastructure concrete structures.
  { id: "culvert", category: "CIVIL & INFRASTRUCTURE", section: "CIVIL STRUCTURES", name: "Culvert", labour: "footing" },
  { id: "headwall", category: "CIVIL & INFRASTRUCTURE", section: "CIVIL STRUCTURES", name: "Headwall", labour: "wall" },
  { id: "manhole_pit", category: "CIVIL & INFRASTRUCTURE", section: "CIVIL STRUCTURES", name: "Manhole / Pit (in-situ)", labour: "footing" },
  { id: "bridge_abutment", category: "CIVIL & INFRASTRUCTURE", section: "CIVIL STRUCTURES", name: "Bridge Abutment", labour: "wall" },
];

export const CATEGORY_ORDER = [...new Set(ELEMENT_TYPES.map((t) => t.category))];
export const SECTION_ORDER = [...new Set(ELEMENT_TYPES.map((t) => t.section))];

/* ---------- Quote pipeline status ----------
 * A project's own stage through the estimating/quoting pipeline —
 * distinct from Cost Planner's post-award project/tender status (Active/On
 * Hold/Complete, Tendering/Submitted/Won/Lost in cost-planner.html), which
 * tracks a job already won. This tracks getting there. Order below is the
 * pipeline order, used both for the Dashboard's status dropdown and for
 * "sort by status". `quote.status` defaults to QUOTE_STATUSES[0] for any
 * quote that predates this field (see Dashboard.jsx) — never rendered as
 * blank/unknown.
 */
export const QUOTE_STATUSES = ["Queued", "Estimating", "Completed Estimating", "Quoting", "Submitted", "Tendered", "Successful", "Unsuccessful", "On Hold"];
export const QUOTE_STATUS_STYLES = {
  Queued: { bar: "bg-violet-400", dot: "bg-violet-400", text: "text-violet-600", bg: "bg-violet-50" },
  Estimating: { bar: "bg-red-500", dot: "bg-red-500", text: "text-red-600", bg: "bg-red-50" },
  // Estimate finished, quote not yet drafted — sits between Estimating (red) and Quoting (blue).
  "Completed Estimating": { bar: "bg-teal-500", dot: "bg-teal-500", text: "text-teal-700", bg: "bg-teal-50" },
  Quoting: { bar: "bg-blue-500", dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" },
  // Quote finished and sent to the client — sits between Quoting (blue) and Tendered (amber).
  Submitted: { bar: "bg-sky-400", dot: "bg-sky-400", text: "text-sky-700", bg: "bg-sky-50" },
  Tendered: { bar: "bg-amber-500", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  Successful: { bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  // Distinct from Estimating's red (now that it's taken) rather than a near-duplicate shade.
  Unsuccessful: { bar: "bg-stone-500", dot: "bg-stone-500", text: "text-stone-600", bg: "bg-stone-100" },
  "On Hold": { bar: "bg-neutral-300", dot: "bg-neutral-300", text: "text-neutral-500", bg: "bg-neutral-100" },
};

/* ---------- Planner priority (Planner tab — see components/PlannerView.jsx) ---------- */
export const PLANNER_PRIORITIES = ["Urgent", "High", "Medium", "Low"];
export const PLANNER_PRIORITY_STYLES = {
  Urgent: { text: "text-red-600", bg: "bg-red-50", dot: "bg-red-500" },
  High: { text: "text-orange-600", bg: "bg-orange-50", dot: "bg-orange-500" },
  Medium: { text: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-400" },
  Low: { text: "text-neutral-500", bg: "bg-neutral-100", dot: "bg-neutral-300" },
};

/* ---------- Overhead/contingency/margin ladder ----------
 * Applied in sequence: Direct Cost -> (+Overheads% +Contingency%) ->
 * Subtotal -> /(1-margin) -> Sell ex GST -> *1.1 -> Sell inc GST.
 * Percentages are always stored as fractions (0.08, not 8) — see
 * CLAUDE.md "the 15-vs-0.15 gotcha" before touching this.
 */
export const MARGIN_STEPS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
export const DEFAULT_MARGIN = 0.30;
export const GST_RATE = 0.10; // Australian GST — change here if this is ever used outside AU
