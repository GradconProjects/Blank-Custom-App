/**
 * Bridge from the Estimates (Element Takeoff Engine) tool into a Quotes
 * project. Pure functions only — no React, no DOM — so this can be
 * Node-tested the same way lib/costing.js is (see scripts/verify.mjs).
 *
 * The Estimates tool and the Quotes catalog are two independently-authored
 * schemas that were never designed to line up 1:1: Estimates computes
 * generic quantities (a bar diameter + length, a concrete grade + volume,
 * an area of formwork) while the Quotes catalog prices specific named
 * BOMA SKUs. Where the mapping is unambiguous we prefill the quantity;
 * everywhere it isn't (multiple products could apply, or nothing in the
 * catalog corresponds at all) we DON'T guess a number into the quote — we
 * add a flag describing exactly what was found so the estimator enters it
 * by hand. Silently prefilling a wrong SKU is worse than leaving it blank.
 */
import { ELEMENT_TYPES, FULL_CATALOG } from "../data/catalog.js";
import { newElementItem, rateKey } from "./costing.js";

export const ESTIMATE_EXPORT_KEY = "boma-estimate-export";

/**
 * Estimates "category" (the def.label shown on every takeoff line, e.g.
 * "Bored Pier") -> Quotes ELEMENT_TYPES id, or null where there's no
 * reasonable equivalent in the Quotes catalog. Deliberately conservative:
 * a wrong element-type match buries a line under the wrong cost category,
 * which is worse than not creating it and flagging the raw numbers instead.
 */
export const ESTIMATE_TYPE_MAP = {
  "Bulk Excavation": "excavation_bulk",
  "Footing Excavation (standalone)": "excavation_trench",
  "Slab Trim / Cut-to-fall": null,
  "Backfill": "backfill_compaction",
  "Strip Footing": "strip_footings",
  "Pad Footing": "pile_caps_pad",
  "Stump Footing Pad": "stump_footings",
  "Bored Pier": "piles_bored",
  // Estimates' generic "Piles" type (driven/screw/CFA, same circular
  // calculator as Bored Pier) lands on the same Quotes bored-pile element —
  // it's the only piling element Quotes prices by schedule, and Screw Piles
  // is a subcontract line rather than a takeoff target.
  "Piles": "piles_bored",
  "Pile Cap": "pile_caps_pad",
  "Ground Beam": null,
  "Column Base Plate / Grout Pad": "column_base_plate",
  "Raft Slab": "raft_foundation",
  "Waffle Slab": "slab_on_ground",
  "Industrial Slab": "slab_on_ground",
  "Slab on Ground": "slab_on_ground",
  "Suspended Slab": "suspended_slab",
  "Suspended Beam": "suspended_beam",
  "Column": "rc_columns",
  "Concrete Wall / Core": "core_shear_wall",
  "Retaining Wall": "retaining_wall",
  "Concrete Stair": "staircase",
  "Ramp / External Sloped Slab": "ramp",
  "RC Roof Slab": "suspended_slab",
  "Driveway": "driveway_hardstand",
  "Path": "paths_paving",
  "Hardstand": "driveway_hardstand",
  "Equipment Pad": null,
  "Kerb / Channel / Spoon Drain": "kerbs_channels",
  "Drill & Dowel": null,
  "Concrete Repair": null,
  "Crack Repair / Sealing": null,
  "Turntable Slab (vehicle turntable)": null,
  "Swimming Pool (concrete shell)": null,
  "Concrete Planter / Garden Bed": "planter_wall",
  "Water Tank (in-ground)": null,
  "Sump Pit (drainage)": "manhole_pit",
};

const QUOTES_TYPE_BY_ID = {};
ELEMENT_TYPES.forEach((t) => { QUOTES_TYPE_BY_ID[t.id] = t; });

const CONCRETE_CAT = FULL_CATALOG.find((c) => c.key === "CONCRETE");
const PROCESSED_BAR_CAT = FULL_CATALOG.find((c) => c.key === "PROCESSED BAR");
const SQUARE_MESH_CAT = FULL_CATALOG.find((c) => c.key === "SQUARE MESH");
const FORMWORK_CAT = FULL_CATALOG.find((c) => c.key === "FORMWORK");

/** Extracts a grade number (e.g. 32 from "N32 concrete") from free text. */
function extractGrade(text) {
  const m = String(text || "").match(/N?(\d{2})\s*(?:mpa|MPA|concrete)?/);
  return m ? m[1] : null;
}

/** Picks the best concrete product for a grade. Prefers the plain "NN mpa"
 * product over Agilia/walls variants when several exist for that grade, but
 * always reports whether the pick was ambiguous so it can be flagged. */
function pickConcreteProduct(grade) {
  if (!CONCRETE_CAT || !grade) return { product: null, ambiguous: false, candidates: [] };
  const candidates = CONCRETE_CAT.products.filter((p) => {
    const g = p.name.match(/^(\d{2})\s*mpa/i);
    return g && g[1] === grade;
  });
  if (candidates.length === 0) return { product: null, ambiguous: false, candidates: [] };
  const plain = candidates.find((p) => /^\d{2}\s*mpa$/i.test(p.name));
  return { product: plain || candidates[0], ambiguous: candidates.length > 1, candidates };
}

function findBarProduct(dia) {
  if (!PROCESSED_BAR_CAT) return null;
  return PROCESSED_BAR_CAT.products.find((p) => p.name === dia) || null;
}

function findMeshProduct(meshType) {
  if (!SQUARE_MESH_CAT) return null;
  return SQUARE_MESH_CAT.products.find((p) => p.name === meshType) || null;
}

function findWallsFormworkProduct() {
  if (!FORMWORK_CAT) return null;
  return FORMWORK_CAT.products.find((p) => p.name === "Walls" && p.unit === "m2") || null;
}

const INSULATION_CAT = FULL_CATALOG.find((c) => c.key === "INSULATION");
function findFormworkProduct(name, unit) {
  if (!FORMWORK_CAT) return null;
  const p = FORMWORK_CAT.products.find((pr) => pr.name === name && pr.unit === unit);
  return p ? { name: p.name, unit: p.unit } : null;
}
function findInsulationProduct(name, unit) {
  if (!INSULATION_CAT) return null;
  const p = INSULATION_CAT.products.find((pr) => pr.name === name && pr.unit === unit);
  return p ? { name: p.name, unit: p.unit } : null;
}
// The Estimates formwork-system choice travels on every formwork line's spec
// (e.g. "150mm edge · Bondek (permanent metal deck)") — where that names a
// specific priced FORMWORK product, land the area straight on it.
const FORMWORK_SYSTEM_PRODUCTS = [
  [/bondek/i, "Bondek"],
  [/oregon/i, "Oregon boards"],
  [/walls curved|curved wall/i, "Walls Curved"],
  [/beam \/ fold|beam\/fold|fold sides/i, "Beam/fold sides >400mm d"],
];
function findConventionalFormworkProduct() {
  if (!FORMWORK_CAT) return null;
  return FORMWORK_CAT.products.find((p) => p.name === "Conventional" && p.unit === "m2") || null;
}

/**
 * Groups an Estimates export's flat line array by elementId, resolves each
 * group against the Quotes catalog, and returns a blank-quote-shaped
 * project plus a flat list of human-readable flags for anything that
 * couldn't be confidently prefilled.
 *
 * `estimateExport` shape: { project: {name,jobNumber,client,revision},
 * lines: [{elementId, element, category, materialGroup, material, spec,
 * unit, finalQty, ...}, ...] } — i.e. exactly what the Estimates tool's own
 * allLines() produces, plus its PROJECT metadata.
 */
/**
 * Element names normalised for matching a Quotes card against the Estimates
 * elements behind it: case, punctuation, instance numbers ("Strip Footing
 * 1"), the "(x3 combined)" suffix the merge adds, and a trailing plural all
 * drop out, so "Strip Footing 2", "Strip Footings" and "Strip Footings (x2
 * combined)" all reduce to the same key.
 */
export function normalizeElementName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")     // "(x2 combined)"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d+\b/g, " ")       // instance numbers
    .trim()
    .replace(/s\b/g, "")            // footings -> footing
    .replace(/\s+/g, "");
}

/**
 * The measured length/area behind a Quotes element, summed across EVERY
 * Estimates element whose name matches it — so a single "Strip Footings"
 * card picks up all the strip footing instances on the takeoff and divides
 * by their combined length. Either name may contain the other (a Quotes
 * card called "Ground Floor - Slab on Ground" still matches the takeoff's
 * "Slab on Ground 1"), which is what lets renamed cards keep matching.
 */
export function geometryForLabel(label, estimateGeometry) {
  const want = normalizeElementName(label);
  if (!want || !Array.isArray(estimateGeometry)) return null;
  const hits = estimateGeometry.filter((g) => {
    const have = normalizeElementName(g.name);
    return have && (have === want || have.includes(want) || want.includes(have));
  });
  if (hits.length === 0) return null;
  const sum = (k) => Math.round(hits.reduce((s, g) => s + (Number(g[k]) || 0), 0) * 100) / 100;
  return { runM: sum("runM"), areaM2: sum("areaM2"), matched: hits.map((h) => h.name) };
}

export function buildImportFromEstimate(estimateExport) {
  const project = estimateExport?.project || {};
  // Only actually-used rows — a line with no quantity yet (an element added to the
  // Workspace but not filled in) shouldn't create a flag or a phantom quantity.
  const lines = (Array.isArray(estimateExport?.lines) ? estimateExport.lines : [])
    .filter((l) => (Number(l.finalQty) || 0) > 0);
  // The Estimates "Project Geometry" table, keyed by elementId:
  // {runM, areaM2} per element. Absent in exports published before that
  // table existed — those elements simply carry no benchmark divisors.
  const elementGeometry = estimateExport?.elementGeometry || {};

  const flags = [];
  const items = [];

  const byElement = new Map();
  lines.forEach((l) => {
    if (!byElement.has(l.elementId)) byElement.set(l.elementId, []);
    byElement.get(l.elementId).push(l);
  });

  byElement.forEach((group, elementId) => {
    const first = group[0];
    const estimateLabel = first.category; // e.g. "Bored Pier"
    const elementLabel = first.element; // e.g. "Bored Pier 1"
    const typeId = Object.prototype.hasOwnProperty.call(ESTIMATE_TYPE_MAP, estimateLabel)
      ? ESTIMATE_TYPE_MAP[estimateLabel]
      : undefined;

    if (typeId === undefined) {
      flags.push(
        `${elementLabel}: "${estimateLabel}" is a type this bridge doesn't know about yet — ` +
        `add it to ESTIMATE_TYPE_MAP in lib/estimateImport.js, or add the element manually in Quotes.`
      );
      return;
    }
    if (typeId === null) {
      const totals = summarizeGroup(group);
      flags.push(
        `${elementLabel} (${estimateLabel}): no matching Quotes element type — add it manually. ` +
        `Totals from the estimate: ${totals}`
      );
      return;
    }

    const type = QUOTES_TYPE_BY_ID[typeId];
    if (!type) {
      flags.push(`${elementLabel}: mapped to unknown Quotes type id "${typeId}" — check ESTIMATE_TYPE_MAP.`);
      return;
    }

    const item = newElementItem(type);
    item.label = elementLabel;
    // Measured geometry from the takeoff's Project Geometry table — the
    // divisors behind this element's $/lm and $/m² benchmark rates.
    const geom = elementGeometry[elementId] || {};
    if (Number(geom.runM) > 0) item.measureLm = Number(geom.runM);
    if (Number(geom.areaM2) > 0) item.measureM2 = Number(geom.areaM2);
    // Marks this card as owned by the Estimates bridge: a re-publish replaces
    // fromEstimate items wholesale but leaves the estimator's manually added
    // cards on the same project untouched (see the merge in App.jsx).
    item.fromEstimate = true;

    // `handled` tracks exactly which lines ended up EITHER mapped into
    // item.qtys OR explicitly flagged, so the final sweep below can catch
    // anything neither happened to (e.g. ligature bars, recorded as a bare
    // count with no length line — earlier versions of this bridge dropped
    // those silently because they don't fit the "aggregate by length"
    // pattern every other bar line does). Nothing is allowed to fall
    // through without either a number in the quote or a flag about it.
    const handled = new Set();
    const flag = (l, msg) => { handled.add(l); flags.push(msg); };
    const map = (l, key, qty) => { handled.add(l); item.qtys[key] = (Number(item.qtys[key]) || 0) + qty; };

    // --- Concrete: group by grade, aggregate m³ ---
    const concreteLines = group.filter((l) => l.materialGroup === "Concrete" && (l.unit === "m³" || l.unit === "m3"));
    const concreteByGrade = {};
    concreteLines.forEach((l) => {
      const grade = extractGrade(l.material) || extractGrade(l.spec) || "?";
      (concreteByGrade[grade] = concreteByGrade[grade] || []).push(l);
    });
    Object.entries(concreteByGrade).forEach(([grade, lines]) => {
      const qty = lines.reduce((s, l) => s + (Number(l.finalQty) || 0), 0);
      if (grade === "?") {
        lines.forEach((l) => flag(l, `${elementLabel}: ${qty.toFixed(2)} m³ of concrete with no readable grade — set manually.`));
        return;
      }
      const { product, ambiguous, candidates } = pickConcreteProduct(grade);
      if (!product) {
        lines.forEach((l) => flag(l, `${elementLabel}: ${qty.toFixed(2)} m³ of N${grade} concrete — no catalog product for that grade, add manually.`));
        return;
      }
      lines.forEach((l) => map(l, rateKey("CONCRETE", product.name, product.unit), Number(l.finalQty) || 0));
      if (ambiguous) {
        flags.push(
          `${elementLabel}: ${qty.toFixed(2)} m³ of N${grade} concrete prefilled against "${product.name}" — ` +
          `${candidates.length} matching products exist (${candidates.map((c) => c.name).join(", ")}), verify the right mix was picked.`
        );
      }
    });

    // --- Reinforcement / Connections / Joints bars: group by diameter, aggregate length (m) ---
    const barLines = group.filter((l) => ["Reinforcement", "Connections", "Joints"].includes(l.materialGroup) && l.unit === "m");
    const barsByDia = {};
    barLines.forEach((l) => { (barsByDia[l.material] = barsByDia[l.material] || []).push(l); });
    Object.entries(barsByDia).forEach(([dia, lines]) => {
      const len = lines.reduce((s, l) => s + (Number(l.finalQty) || 0), 0);
      const product = findBarProduct(dia);
      if (!product) {
        lines.forEach((l) => flag(l, `${elementLabel}: ${len.toFixed(1)} m of ${dia} reinforcement — no matching Processed Bar product, add manually.`));
        return;
      }
      lines.forEach((l) => map(l, rateKey("PROCESSED BAR", product.name, product.unit), Number(l.finalQty) || 0));
    });

    // --- Square Mesh: Quotes takes m² of coverage directly (it works out the
    // sheet count itself — see areaBasis in data/catalog.js), so any
    // Reinforcement line in m² whose material is a real SL/RL mesh code
    // maps straight across. The one exception is trench mesh: Estimates
    // reuses the same SL/RL codes there for its own mass estimate, but a
    // Quotes Trench Mesh product is a completely different, bar-count-coded
    // SKU ("4 Bar-L12TM") — an SL/RL code there does NOT identify a real
    // Square Mesh sheet, so it's flagged instead of mapped.
    group.filter((l) => l.materialGroup === "Reinforcement" && l.spec === "Trench mesh").forEach((l) => {
      flag(l,
        `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} m² of ${l.material} trench mesh — Quotes' Trench Mesh ` +
        `catalog is priced by bar-count/length code (e.g. "4 Bar-L12TM"), not by SL/RL sheet type — pick the right product manually.`
      );
    });
    group.filter((l) =>
      l.materialGroup === "Reinforcement" && (l.unit === "m²" || l.unit === "m2") && !handled.has(l)
    ).forEach((l) => {
      const product = findMeshProduct(l.material);
      if (!product) return; // not a mesh line at all (e.g. a bar-based reo area) — the sweep below flags it
      map(l, rateKey("SQUARE MESH", product.name, product.unit), Number(l.finalQty) || 0);
    });

    // --- Formwork: wall lines map to "Walls"; every other m² formwork line (footings,
    // slabs, beams, stairs, shotcrete, retaining walls, etc. — Estimates always produces
    // formwork in m²) maps to the catalog's generic "Conventional" line, so a quantity
    // always crosses into the quote instead of being left for manual entry. A flag still
    // calls out the non-wall ones so the estimator can swap to Bondek/Edgeform/curved/etc.
    // if a different system actually applies to that line.
    const formworkLines = group.filter((l) => l.materialGroup === "Formwork");
    let wallFormworkArea = 0;
    const wallFormworkLines = [];
    let otherFormworkArea = 0;
    const otherFormworkLines = [];
    formworkLines.forEach((l) => {
      const text = `${l.spec || ""} ${l.material || ""}`;
      const isM2 = l.unit === "m²" || l.unit === "m2";
      // Named system on the line -> the exact priced FORMWORK product.
      if (isM2) {
        const sys = FORMWORK_SYSTEM_PRODUCTS.find(([re]) => re.test(text));
        if (sys) {
          const product = findFormworkProduct(sys[1], "m2");
          if (product) { map(l, rateKey("FORMWORK", product.name, product.unit), Number(l.finalQty) || 0); return; }
        }
      }
      // Per-metre edge-board formwork (slab edges, opening reveals, step-down
      // faces) -> the per-m "Edgeform" product.
      if (l.unit === "m" && /edge|reveal|step-down face/i.test(text)) {
        const product = findFormworkProduct("Edgeform", "m");
        if (product) { map(l, rateKey("FORMWORK", product.name, product.unit), Number(l.finalQty) || 0); return; }
      }
      const isWall = /wall/i.test(l.spec || "") || /wall/i.test(l.material || "");
      if (!isM2) {
        flag(l,
          `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} ${l.unit} of formwork (${l.material || l.spec}) — ` +
          `no confident catalog match, pick the right formwork system manually.`
        );
        return;
      }
      if (isWall) { wallFormworkArea += Number(l.finalQty) || 0; wallFormworkLines.push(l); }
      else { otherFormworkArea += Number(l.finalQty) || 0; otherFormworkLines.push(l); }
    });
    if (wallFormworkArea > 0) {
      const product = findWallsFormworkProduct();
      if (product) {
        wallFormworkLines.forEach((l) => map(l, rateKey("FORMWORK", product.name, product.unit), Number(l.finalQty) || 0));
      } else {
        wallFormworkLines.forEach((l) => flag(l, `${elementLabel}: ${wallFormworkArea.toFixed(2)} m² of wall formwork — Walls product missing from catalog, add manually.`));
      }
    }
    if (otherFormworkArea > 0) {
      const product = findConventionalFormworkProduct();
      if (product) {
        otherFormworkLines.forEach((l) => {
          map(l, rateKey("FORMWORK", product.name, product.unit), Number(l.finalQty) || 0);
          flag(l,
            `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} m² of formwork (${l.material || l.spec}) prefilled against ` +
            `"Conventional" — switch to a different Formwork product if a different system applies.`
          );
        });
      } else {
        otherFormworkLines.forEach((l) => flag(l, `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} m² of formwork (${l.material || l.spec}) — no confident catalog match, pick the right formwork system manually.`));
      }
    }

    // --- Insulation: Estimates emits the Quotes catalog product names
    // verbatim (see INSULATION_TYPES in the Estimates app), so an exact
    // name+unit match lands the quantity straight on the priced product. ---
    group.filter((l) => l.materialGroup === "Insulation").forEach((l) => {
      const unit = (l.unit === "m²" || l.unit === "m2") ? "m2" : l.unit;
      const product = findInsulationProduct(l.material, unit);
      if (product) { map(l, rateKey("INSULATION", product.name, product.unit), Number(l.finalQty) || 0); return; }
      flag(l, `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} ${l.unit} of insulation (${l.material}) — no matching Insulation catalog product, add manually.`);
    });

    // --- Vapour barrier: Estimates' Base/Blinding membrane lines (m², laps
    // included in finalQty) land on the dedicated OTHER ACCESSORIES "Vapour
    // barrier" product — distinct from Insulation. ---
    group.filter((l) => (l.materialGroup === "Base/Blinding" || l.materialGroup === "Vapour Barrier") && /vapour|membrane/i.test(l.material || "") && (l.unit === "m²" || l.unit === "m2")).forEach((l) => {
      map(l, rateKey("OTHER ACCESSORIES", "Vapour barrier", "m2"), Number(l.finalQty) || 0);
    });

    // --- Sweep: anything not yet mapped or flagged gets one now, so nothing
    // is ever silently lost. A "— mass" line is a pure informational
    // duplicate of its non-mass sibling line ONLY when both describe the
    // exact same bars under matching spec text (true for e.g. "Vertical
    // cage bars" / "Vertical cage bars — mass") — there it's silently
    // dropped once its sibling is mapped or flagged. Some element
    // calculators don't keep the two specs aligned (ligatures are recorded
    // as "Circular ligatures (...)" / "Circular ligatures — mass", which
    // don't share a prefix), so this pairing can't always be recognised —
    // in that case both lines get their own flag rather than either being
    // silently combined or dropped. Slightly redundant is an acceptable
    // outcome here; losing a real quantity silently is not.
    const specOf = (l) => (l.spec || "").replace(/ — mass$/, "");
    const massSiblingOf = (l) => group.find((o) => o.spec === `${specOf(l)} — mass` && o !== l);
    group.forEach((l) => {
      if (handled.has(l)) return;
      const isMass = / — mass$/.test(l.spec || "");
      if (isMass) {
        const sibling = group.find((o) => specOf(o) === specOf(l) && o.spec !== l.spec);
        if (sibling && handled.has(sibling)) { handled.add(l); return; } // redundant with mapped/flagged data
        flag(l, `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} ${l.unit} of ${l.materialGroup} (${l.material} — ${specOf(l)}) — Quotes has no catalog line for this, cost it via labour/other allowances manually.`);
        return;
      }
      const sibling = massSiblingOf(l);
      if (sibling && !handled.has(sibling)) return; // let the mass sibling (more informative) carry the flag instead
      flag(l, `${elementLabel}: ${(Number(l.finalQty) || 0).toFixed(2)} ${l.unit} of ${l.materialGroup} (${l.material || l.spec}) — Quotes has no catalog line for this, cost it via labour/other allowances manually.`);
    });

    items.push(item);
  });

  // --- Combine same-type elements into ONE Quotes element ---
  // Three ground slabs in the takeoff should land as a single "Ground
  // Bearing Slabs" card with summed quantities, not three near-identical
  // cards — the Quotes catalog is priced per product, so the sums are
  // exactly equivalent, and the quote stays readable. The source element
  // names are kept in the merged label so nothing loses its audit trail.
  const byType = new Map();
  const mergedItems = [];
  items.forEach((item) => {
    const prior = byType.get(item.typeId);
    if (!prior) {
      byType.set(item.typeId, { item, labels: [item.label] });
      mergedItems.push(item);
      return;
    }
    Object.entries(item.qtys).forEach(([key, qty]) => {
      prior.item.qtys[key] = (Number(prior.item.qtys[key]) || 0) + (Number(qty) || 0);
    });
    // Quantities combine, so their geometry must too: three strip footings
    // merged into one card divide by the three strips' TOTAL length/area.
    ["measureLm", "measureM2"].forEach((k) => {
      if (Number(item[k]) > 0) {
        prior.item[k] = Math.round(((Number(prior.item[k]) || 0) + Number(item[k])) * 100) / 100;
      }
    });
    prior.labels.push(item.label);
    const typeName = QUOTES_TYPE_BY_ID[item.typeId]?.name || prior.labels[0];
    prior.item.label = `${typeName} (×${prior.labels.length} combined)`;
    prior.item.description = `Combined from Estimates elements: ${prior.labels.join(", ")}.`;
  });

  const quote = {
    projectName: project.name ? `${project.name} (from Estimates)` : "Imported from Estimates",
    projectDate: new Date().toISOString().slice(0, 10),
    gfa: undefined,
    overheadPct: 0.08,
    contingencyPct: 0.05,
    items: mergedItems,
    importMeta: {
      jobNumber: project.jobNumber || "",
      client: project.client || "",
      revision: project.revision || "",
      importedAt: new Date().toISOString(),
    },
    importFlags: flags,
    // Every takeoff element's measured geometry WITH its name, kept so the
    // Quotes project can re-match by name later (see geometryForLabel) —
    // after a card is renamed, added by hand, or split.
    estimateGeometry: Object.entries(elementGeometry).map(([id, g]) => ({
      id,
      name: (lines.find((l) => l.elementId === id) || {}).element || "",
      runM: Number(g.runM) || 0,
      areaM2: Number(g.areaM2) || 0,
    })).filter((g) => g.name && (g.runM > 0 || g.areaM2 > 0)),
  };

  return { quote, flags };
}

function summarizeGroup(group) {
  const concrete = group.filter((l) => l.materialGroup === "Concrete").reduce((s, l) => s + (Number(l.finalQty) || 0), 0);
  const formwork = group.filter((l) => l.materialGroup === "Formwork").reduce((s, l) => s + (Number(l.finalQty) || 0), 0);
  const reoKg = group
    .filter((l) => ["Reinforcement", "Connections", "Joints"].includes(l.materialGroup) && l.unit === "kg")
    .reduce((s, l) => s + (Number(l.finalQty) || 0), 0);
  const parts = [];
  if (concrete > 0) parts.push(`${concrete.toFixed(2)} m³ concrete`);
  if (formwork > 0) parts.push(`${formwork.toFixed(2)} m² formwork`);
  if (reoKg > 0) parts.push(`${reoKg.toFixed(1)} kg reo`);
  return parts.length ? parts.join(", ") : "(see the Estimates Quantity Register for this element)";
}
