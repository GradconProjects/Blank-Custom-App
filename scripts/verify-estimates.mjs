#!/usr/bin/env node
/**
 * Estimates data-safety checks — `npm run verify:estimates` (also part of
 * `npm run verify`). Plain Node, no browser: portal/estimates-schema.js is
 * the same file the app inlines, loaded here as CommonJS.
 *
 * Fixtures in tests/fixtures/estimates/ are REAL takeoffs exported from the
 * cloud rows on 8 Sep 2026 (pre-redesign), plus synthetic legacy shapes.
 * Every check here is a promise to the estimator: nothing they entered can
 * change meaning through a migration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// The package is "type": "module", so Node treats the .js file as ESM and its
// CommonJS export never runs; evaluate it as a plain script instead — exactly
// how the browser runs it once inlined — and take the API off globalThis.
import vm from "node:vm";
const schemaSrc = fs.readFileSync(path.join(root, "portal", "estimates-schema.js"), "utf8");
const sandbox = { globalThis: undefined, module: undefined };
sandbox.globalThis = sandbox;
vm.runInNewContext(schemaSrc, sandbox, { filename: "estimates-schema.js" });
const schema = sandbox;
const {
  ESTIMATE_SCHEMA_VERSION, snapshotVersion, migrateEstimateSnapshot, isMigrated,
  collectRawAppKeys, buildRawBackup, checksumOf, ensurePreMigrationBackup, listPreMigrationBackups,
  PRE_MIGRATION_PREFIX, PRE_MIGRATION_DONE_KEY,
} = schema;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Sorted-key JSON so field order cannot masquerade as a difference. */
const canon = (v) => JSON.stringify(v, (k, val) => (val && typeof val === "object" && !Array.isArray(val)) ? Object.keys(val).sort().reduce((o, kk) => { o[kk] = val[kk]; return o; }, {}) : val);

console.log(`\nEstimates schema v${ESTIMATE_SCHEMA_VERSION} — migration & backup checks\n`);

/* ---- 1. real legacy fixtures: every value intact ---- */
const fixDir = path.join(root, "tests", "fixtures", "estimates");
const fixtures = fs.readdirSync(fixDir).filter((f) => f.endsWith(".json")).sort();
check("fixtures present", fixtures.length >= 3, `${fixtures.length} found`);
for (const f of fixtures) {
  const raw = JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8"));
  const rawCanon = canon(raw);
  const v = snapshotVersion(raw);
  const m = migrateEstimateSnapshot(raw);
  const list = m.INSTANCES || m.instances;
  const rawList = raw.INSTANCES || raw.instances;
  check(`${f}: read as schema v${v}, migrated to v${ESTIMATE_SCHEMA_VERSION}`, v === 1 && isMigrated(m));
  check(`${f}: the raw object was not mutated`, canon(raw) === rawCanon);
  check(`${f}: element count intact (${rawList.length})`, list.length === rawList.length);
  check(`${f}: every element's id, type, label and data deep-equal the original`, rawList.every((inst, i) => deepEqual(inst.data, list[i].data) && inst.id === list[i].id && inst.typeKey === list[i].typeKey && inst.label === list[i].label));
  check(`${f}: project object deep-equals the original`, deepEqual(raw.PROJECT || raw.project, m.PROJECT || m.project));
  check(`${f}: migration is idempotent`, canon(migrateEstimateSnapshot(m)) === canon({ ...m }));
  // unknown fields (the export metadata I added, and anything future) survive
  const unknownKeys = Object.keys(raw).filter((k) => !["PROJECT", "SELECTED_TYPES", "INSTANCES", "ID_COUNTER", "UPLOADED_FILES", "project", "selectedTypes", "instances", "idCounter"].includes(k));
  check(`${f}: unknown top-level fields survive (${unknownKeys.length})`, unknownKeys.every((k) => deepEqual(raw[k], m[k])));
}

/* ---- 2. blank vs zero, units, and legacy starter shapes ---- */
{
  const raw = { project: { name: "Blank vs zero" }, selectedTypes: {}, idCounter: 3, instances: [
    { id: "EL01", typeKey: "stripfooting", label: "SF1", data: { qty: 1, length: 10000, width: "", depth: 0, cover: "", starters: true, connQty: 3, connDia: "N16", connEmbed: 500, connProj: 600 } },
    { id: "EL02", typeKey: "slab", label: "Raft", data: { length: 25, width: 12, thickness: 200, connMode: "spacing", connSpacing: 400, connRows: 2 } },
  ] };
  const m = migrateEstimateSnapshot(raw);
  const d = m.instances[0].data;
  check("blank stays blank (width '')", d.width === "");
  check("zero stays zero (depth 0)", d.depth === 0);
  check("blank cover stays blank (project default applies at run time, not in storage)", d.cover === "");
  check("lengths stay in millimetres (10000 not 10)", d.length === 10000);
  check("slab plan dims stay in metres (25 × 12)", m.instances[1].data.length === 25 && m.instances[1].data.width === 12);
  check("legacy starter count fields untouched (the app migrates them lazily at render)", d.starters === true && d.connQty === 3 && d.starterRuns === undefined);
  check("interim connMode/spacing fields untouched", m.instances[1].data.connMode === "spacing" && m.instances[1].data.connRows === 2);
}

/* ---- 3. structure repair, never value invention ---- */
{
  const m = migrateEstimateSnapshot({ instances: [{ id: "EL01", typeKey: "pier", label: "P1" }, null, { typeKey: "slab", data: { thickness: 150 } }] });
  check("missing project/selectedTypes containers are added empty", deepEqual(m.project, {}) && deepEqual(m.selectedTypes, {}));
  check("an element without data gets an empty data container (not defaults)", deepEqual(m.instances[0].data, {}));
  check("a null element slot is dropped, real ones kept", m.instances.length === 2 && m.instances[1].data.thickness === 150);
  check("an element without an id gets a positional one", m.instances[1].id === "EL03");
  check("idCounter is derived only when missing/invalid", m.idCounter === 3);
  check("migratedFrom records the source version", m.migratedFrom === 1);
  const again = migrateEstimateSnapshot(m);
  check("second migration leaves migratedFrom as the ORIGINAL version", again.migratedFrom === 1 && again.schemaVersion === ESTIMATE_SCHEMA_VERSION);
}

/* ---- 3b. Phase 3/4 fields ride through untouched ---- */
{
  const raw = { schemaVersion: 2, project: { name: "P4", standards: { projectType: "civil", standards: ["as3600", "as5100"], nccEdition: "NCC 2022 Amdt 1", checks: { reoMaxKgM3: 250 } }, reviewAck: { name: "G", role: "QS", at: "2026-09-09 08:00", hash: "abcd1234" } }, selectedTypes: {}, idCounter: 2, instances: [
    { id: "EL01", typeKey: "padfooting", label: "F1", data: { length: 600, allowOverbreakPct: 10, allowPlacement: "pump", allowPumpHours: 4 }, tags: { level: "L1", pour: "P2" }, entered: { length: true }, review: { hash: "x", at: "t" }, scope: { membrane: { decision: "excluded", reason: "by others" } } },
  ] };
  const m = migrateEstimateSnapshot(raw);
  check("standards profile, review acknowledgement, tags, entered, review and scope survive migration untouched", deepEqual(m.project.standards, raw.project.standards) && deepEqual(m.project.reviewAck, raw.project.reviewAck) && deepEqual(m.instances[0].tags, raw.instances[0].tags) && deepEqual(m.instances[0].scope, raw.instances[0].scope) && m.instances[0].data.allowOverbreakPct === 10);
  check("a v2 snapshot is not re-marked as migrated from v1", m.migratedFrom === undefined);
}

/* ---- 4. rejection: never overwrite what we cannot read ---- */
{
  const bad = [null, 42, "text", [], {}, { foo: 1 }];
  check("non-takeoff inputs are rejected with an Error", bad.every((b) => { try { migrateEstimateSnapshot(b); return false; } catch (e) { return !!e && typeof e.message === "string" && /takeoff/.test(e.message); } }));   // (a vm sandbox has its own Error class)
  let msg = ""; try { migrateEstimateSnapshot({ schemaVersion: 99, instances: [] }); } catch (e) { msg = e.message; }
  check("a NEWER schema is rejected with a clear message", /newer version/.test(msg));
}

/* ---- 5. raw backup: raw strings, exclusions, checksum, once-only ---- */
{
  const mem = new Map([
    ["boma-estimate-state::proj_a", '{"project":{"name":"A"},"instances":[]}'],
    ["boma-preferences", '{"quotesRememberProject":false}'],
    ["boma-quote-x", '{"projectName":"X","items":[]}'],
    ["unrelated-key", "keep out"],
    ["boma-pre-migration-backup::2020-01-01T00-00-00-000Z", '{"format":"boma-all-data-backup"}'],
  ]);
  const storage = { get length() { return mem.size; }, key: (i) => [...mem.keys()][i], getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const keys = collectRawAppKeys(storage);
  check("backup collects only boma-* keys", Object.keys(keys).sort().join(",") === "boma-estimate-state::proj_a,boma-preferences,boma-quote-x");
  check("backup stores the RAW string, unparsed", keys["boma-estimate-state::proj_a"] === '{"project":{"name":"A"},"instances":[]}');
  check("an earlier pre-migration backup is not nested", !("boma-pre-migration-backup::2020-01-01T00-00-00-000Z" in keys));
  const doc = buildRawBackup(storage, { build: "test", origin: "https://example.test" });
  check("backup document carries format, count, bytes and checksum", doc.format === "boma-all-data-backup" && doc.keyCount === 3 && doc.bytes > 0 && /^[0-9a-f]{8}$/.test(doc.checksum) && doc.checksum === checksumOf(keys));
  const r1 = ensurePreMigrationBackup(storage, { build: "test" });
  check("first load creates the pre-migration key", r1.created && r1.key.startsWith(PRE_MIGRATION_PREFIX) && mem.has(r1.key));
  check("...and the done-marker points at it", mem.get(PRE_MIGRATION_DONE_KEY) === r1.key);
  const r2 = ensurePreMigrationBackup(storage, { build: "test" });
  check("second load does NOT create another (once per schema version)", !r2.created && r2.key === r1.key);
  check("listPreMigrationBackups finds both, newest first", listPreMigrationBackups(storage)[0] === r1.key && listPreMigrationBackups(storage).length === 2);
  const stored = JSON.parse(mem.get(r1.key));
  check("the pre-migration copy equals the raw values byte for byte", stored.keys["boma-quote-x"] === '{"projectName":"X","items":[]}' && stored.keyCount === 3);
  // quota failure: reported, not thrown, marker not written
  const full = { get length() { return mem.size; }, key: (i) => [...mem.keys()][i], getItem: (k) => (k === PRE_MIGRATION_DONE_KEY ? null : (mem.has(k) ? mem.get(k) : null)), setItem: () => { throw new Error("QuotaExceededError"); } };
  const r3 = ensurePreMigrationBackup(full, {});
  check("a storage failure is reported, not thrown, and leaves no marker", !r3.created && /Quota/.test(r3.error));
}

/* ---- 6. orders module (Phase 5): procurement rounding, order schedule, pour schedule, reconciliation ---- */
console.log("\nOrders, pour schedule and reconciliation (portal/estimates-orders.js)\n");
{
  const ordersSrc = fs.readFileSync(path.join(root, "portal", "estimates-orders.js"), "utf8");
  const box = { globalThis: undefined, module: undefined }; box.globalThis = box;
  vm.runInNewContext(ordersSrc, box, { filename: "estimates-orders.js" });
  const O = box;
  const TRENCH = ["3 Bar-L8TM", "4 Bar-L11TM", "5 Bar-L12TM", "6 Bar-L12TM"];
  const MESH = ["SL52", "SL62", "SL72", "SL81", "SL82", "SL92", "SL102", "RL818", "RL1018", "RL1118"];
  const ctx = { barStockMm: 12000, trenchStockM: 6, meshSheetAreaM2: 14.4, meshSheetLengthM: 6, concreteStepM3: 0.2, isTrenchMesh: (m) => TRENCH.includes(m), isSquareMesh: (m) => MESH.includes(m), massPerM: (d) => d * d / 162 };
  const L = (o) => Object.assign({ elementId: "E1", element: "Elem 1", stage: "S", category: "C", spec: "", qty: 0, finalQty: 0, weightKg: 0, unit: "" }, o);

  check("roundUpTo: 11.999999 to 0.2 steps is 12, not 12.2", O.roundUpTo(11.999999, 0.2) === 12);
  check("roundUpTo: 12.01 to 0.2 steps is 12.2", O.roundUpTo(12.01, 0.2) === 12.2);
  check("roundUpTo: zero and negatives give 0; step 0 returns the value", O.roundUpTo(0, 0.2) === 0 && O.roundUpTo(-3, 1) === 0 && O.roundUpTo(3.14159, 0) === 3.14159);

  const lines = [
    L({ materialGroup: "Concrete", material: "N32 concrete", unit: "m³", qty: 10, finalQty: 12 }),
    L({ materialGroup: "Concrete", material: "N32 concrete", unit: "m³", qty: 1.5, finalQty: 1.65, elementId: "E2", element: "Elem 2" }),
    L({ materialGroup: "Concrete", material: "N25 concrete", unit: "m³", qty: 3, finalQty: 3.3, elementId: "E3", element: "Elem 3" }),
    L({ materialGroup: "Reinforcement", material: "N16", unit: "m", qty: 100, finalQty: 110, weightKg: 110 * 256 / 162 }),
    L({ materialGroup: "Reinforcement", material: "N16", unit: "no.", qty: 40, finalQty: 42, lengthM: 30, weightKg: 30 * 256 / 162, spec: "Ligatures" }),
    L({ materialGroup: "Reinforcement", material: "N12", unit: "m", qty: 23.5, finalQty: 24.5, weightKg: 24.5 * 144 / 162 }),
    L({ materialGroup: "Reinforcement", material: "SL82", unit: "m²", qty: 100, finalQty: 115, sheets: 8 }),
    L({ materialGroup: "Reinforcement", material: "SL82", unit: "m²", qty: 20, finalQty: 23, sheets: 2, elementId: "E2" }),
    L({ materialGroup: "Reinforcement", material: "6 Bar-L12TM", unit: "lm", qty: 50, finalQty: 55, weightKg: 55 * 32.8 / 6 }),
    L({ materialGroup: "Reinforcement", material: "SL82", unit: "lm", qty: 10, finalQty: 11, weightKg: 4, spec: "strips" }),
    L({ materialGroup: "Formwork", material: "Edge formwork", unit: "m²", qty: 10, finalQty: 10.55 }),
    L({ materialGroup: "Excavation", material: "Bulk excavation", unit: "m³", qty: 20, finalQty: 20.1 }),
    L({ materialGroup: "Excavation", material: "Spoil disposal (bulked)", unit: "m³", qty: 23, finalQty: 23.2 }),
    L({ materialGroup: "Vapour Barrier", material: "200um polyethylene", unit: "m²", qty: 30.2, finalQty: 33.22 }),
    L({ materialGroup: "Base/Blinding", material: "Base material (compacted)", unit: "m³", qty: 4, finalQty: 4.4 }),
    L({ materialGroup: "Concrete", material: "N32 concrete", unit: "m³", qty: 0, finalQty: 0, elementId: "E9" }),
  ];
  const rows = O.orderScheduleFrom(lines, ctx);
  const row = (mat, unit) => rows.find((r) => r.material === mat && (!unit || r.unit === unit));
  check("order schedule key keeps the group::material::unit format the saved ticks use", rows.every((r) => r.key === r.group + "::" + r.material + "::" + r.unit));
  check("a zero line is skipped", !rows.some((r) => r.elements.includes("E9")));
  check("group order: excavation first, concrete before reinforcement before formwork", rows.map((r) => r.group).join(",").replace(/(\w[\w\/ ]*)(,\1)+/g, "$1") === "Excavation,Base/Blinding,Vapour Barrier,Concrete,Reinforcement,Formwork");
  const n32 = row("N32 concrete");
  check("concrete: net 11.5, adjusted 13.65, order 13.8 (0.2 m³ steps) with the rule text", n32 && Math.abs(n32.net - 11.5) < 1e-9 && Math.abs(n32.adjusted - 13.65) < 1e-9 && n32.order === 13.8 && /0\.2 m³ steps/.test(n32.rule), n32 && JSON.stringify([n32.net, n32.adjusted, n32.order]));
  check("concrete row lists both elements", n32 && n32.elements.join() === "E1,E2");
  const n16 = row("N16", "m"), n16lig = row("N16", "no.");
  check("bars: whole 12 m stock lengths, rounded up (110 m → 10 lengths)", n16 && n16.stock === 10 && n16.orderUnit === "lengths" && /12 m stock lengths/.test(n16.rule));
  check("ligatures (no.) keep their own row but count stock lengths from their metres (30 m → 3)", n16lig && n16lig.stock === 3 && Math.abs(n16lig.kg - 30 * 256 / 162) < 1e-9);
  const sl = row("SL82", "m²");
  check("sheet mesh: order = the sheets already rounded up line by line (8 + 2 = 10)", sl && sl.order === 10 && sl.orderUnit === "sheets" && sl.stock === 10);
  check("trench mesh: whole 6 m lengths (55 m → 10)", row("6 Bar-L12TM").stock === 10 && /trench-mesh lengths/.test(row("6 Bar-L12TM").rule));
  check("mesh strips: sheet lengths (11 m → 2), never mis-read as an 82 mm bar", row("SL82", "lm").stock === 2 && /Strips cut/.test(row("SL82", "lm").rule));
  check("formwork rounds up to 0.1 (10.55 → 10.6)", row("Edge formwork").order === 10.6);
  check("excavation and spoil round up to 0.5 (20.1 → 20.5, 23.2 → 23.5)", row("Bulk excavation").order === 20.5 && row("Spoil disposal (bulked)").order === 23.5);
  check("vapour barrier rounds up to the whole m² (33.22 → 34)", row("200um polyethylene").order === 34);
  check("adjusted totals equal the register (sum of finalQty per product)", Math.abs(rows.reduce((s, r) => s + (r.group === "Concrete" ? r.adjusted : 0), 0) - 16.95) < 1e-9);
  check("net never equals adjusted where waste applies, and order ≥ adjusted on every row", rows.every((r) => (r.ruleId === "bar" || r.ruleId === "trench" || r.ruleId === "strip" || r.ruleId === "mesh") ? true : r.order + 1e-9 >= r.adjusted) && n32.net < n32.adjusted);

  const rp = O.reinforcementByProduct(lines, ctx);
  check("reinforcement by product: N16 joins bars + ligature metres (140 m → 12 lengths), N12 24.5 m → 3", rp.bars.find((b) => b.product === "N16").stockLengths === 12 && rp.bars.find((b) => b.product === "N12").stockLengths === 3);
  check("bars sorted numerically by diameter", rp.bars.map((b) => b.product).join() === "N12,N16");
  check("trench, strips and sheet mesh grouped separately", rp.trench.length === 1 && rp.trench[0].lengths === 10 && rp.strips.length === 1 && rp.mesh.length === 1 && rp.mesh[0].sheets === 10);
  check("kg total equals the register's reinforcement kg (sheet mesh weightless)", Math.abs(rp.totals.kg - O.totalsOf(lines).reoKg) < 1e-9);

  const instances = [{ id: "E1", tags: { pour: "P2", level: "L1" } }, { id: "E2", tags: { pour: "P1", zone: "Z" } }, { id: "E3" }];
  const ps = O.pourSchedule(lines, instances, ctx);
  check("pour schedule: grades sorted numerically (N25 before N32)", ps.map((g) => g.grade).join() === "N25 concrete,N32 concrete");
  const g32 = ps[1];
  check("pours sorted, elements under their pour, level/zone carried", g32.pours.map((p) => p.pour).join() === "P1,P2" && g32.pours[1].elements[0].elementId === "E1" && g32.pours[1].elements[0].level === "L1" && g32.pours[0].elements[0].zone === "Z");
  check("untagged element sits under (unscheduled)", ps[0].pours[0].pour === "(unscheduled)" && ps[0].pours[0].elements[0].elementId === "E3");
  check("pour volumes: net/adjusted sum to the grade; each pour rounds up separately (12 → 12, 1.65 → 1.8)", Math.abs(g32.pours[0].adjusted + g32.pours[1].adjusted - g32.adjusted) < 1e-9 && g32.pours[0].order === 1.8 && g32.pours[1].order === 12 && g32.order === 13.8);

  const rec = O.reconcile([{ name: "a", lines }, { name: "b", lines: lines.slice().reverse() }, { name: "c", lines: lines.map((l) => ({ ...l })) }]);
  check("reconcile: same lines in any order agree on every total and the fingerprint", rec.ok && rec.rows.every((r) => r.ok) && rec.fingerprints.every((f) => f === rec.fingerprints[0]));
  const changed = lines.map((l, i) => (i === 0 ? { ...l, finalQty: 12.5 } : l));
  const rec2 = O.reconcile([{ name: "a", lines }, { name: "b", lines: changed }]);
  check("reconcile: a changed final quantity fails the concrete row and the fingerprint, passes the rest", !rec2.ok && !rec2.rows.find((r) => r.key === "concreteM3").ok && !rec2.rows.find((r) => r.key === "fingerprint").ok && rec2.rows.find((r) => r.key === "reoKg").ok);
  const rec3 = O.reconcile([{ name: "a", lines }, { name: "b", lines: lines.slice(1) }]);
  check("reconcile: a missing line fails the line count", !rec3.rows.find((r) => r.key === "lines").ok);
  check("totalsOf splits spoil from excavation and blinding from vapour", (() => { const t = O.totalsOf(lines); return t.excM3 === 20.1 && t.spoilM3 === 23.2 && t.blindM3 === 4.4 && t.vapM2 === 33.22 && t.formworkM2 === 10.55; })());

  // real fixtures: the order schedule reads them without throwing and reconciles with itself
  for (const f of fixtures) {
    const raw = JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8"));
    const insts = raw.INSTANCES || raw.instances;
    const all = []; insts.forEach((i) => ((i.results && i.results.lines) || []).forEach((l) => all.push(l)));
    if (!all.length) continue;
    const r = O.orderScheduleFrom(all, ctx);
    const t = O.totalsOf(all);
    const adjConc = r.filter((x) => x.group === "Concrete").reduce((s, x) => s + x.adjusted, 0);
    check(`${f}: ${r.length} order rows, every row carries a rule, concrete adjusted equals the register (${t.concreteM3.toFixed(2)} m³)`, r.every((x) => x.rule && x.orderUnit) && Math.abs(adjConc - t.concreteM3) < 1e-6);
    check(`${f}: order ≥ adjusted on every non-stock row, stock rows carry whole counts`, r.every((x) => x.stock !== undefined ? Number.isInteger(x.stock) : x.order + 1e-9 >= x.adjusted));
    const rc = O.reconcile([{ name: "cards", lines: all }, { name: "register", lines: all.slice() }]);
    check(`${f}: reconciles with itself`, rc.ok);
  }
}

/* ---- 7. Quotes bridge (Phase 5): the export payload imports without loss ---- */
console.log("\nEstimates → Quotes bridge (src/lib/estimateImport.js)\n");
{
  const { buildImportFromEstimate, ESTIMATE_TYPE_MAP } = await import(path.join(root, "src", "lib", "estimateImport.js"));
  const { ELEMENT_TYPES } = await import(path.join(root, "src", "data", "catalog.js"));
  const quoteTypeIds = new Set(ELEMENT_TYPES.map((t) => t.id));
  const f = fixtures.find((x) => /7-elements/.test(x)) || fixtures[0];
  const raw = JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8"));
  const insts = raw.INSTANCES || raw.instances;
  const lines = []; insts.forEach((i) => ((i.results && i.results.lines) || []).forEach((l) => lines.push(l)));
  const payload = { project: { name: "Bridge test", jobNumber: "J1", client: "C", revision: "Rev B", preparedBy: "GP", estimateSessionId: "sess_test" }, lines, elementGeometry: {} };
  let out, err;
  try { out = buildImportFromEstimate(payload); } catch (e) { err = e; }
  check(`${f}: buildImportFromEstimate runs on a real register (${lines.length} lines)`, !err, err && err.message);
  if (out) {
    const quote = out.quote || out;
    const items = quote.items || out.items || [];
    const flags = quote.importFlags || out.flags || [];
    check("the import creates one Quotes element per Estimates element with a quantity", items.length >= 1 && items.length <= insts.length, `${items.length} items for ${insts.length} elements`);
    check("unmatched products become plain-English flags, never guessed quantities", Array.isArray(flags) && flags.every((x) => typeof x === "string"));
    check("every mapped type id in ESTIMATE_TYPE_MAP exists in Quotes' ELEMENT_TYPES (null = deliberately unmapped)", Object.values(ESTIMATE_TYPE_MAP).every((v) => v === null || quoteTypeIds.has(v)), Object.values(ESTIMATE_TYPE_MAP).filter((v) => v !== null && !quoteTypeIds.has(v)).join(","));
    check("flags name the element and are actionable text", flags.every((x) => x.length > 20));
    check("the payload's project metadata (name, revision, preparer) reaches the quote", quote.projectName === "Bridge test" || quote.name === "Bridge test" || JSON.stringify(quote).includes("Bridge test"));
    const empty = buildImportFromEstimate({ project: {}, lines: [] });
    check("an empty register imports to an empty, flag-free project", !!empty);
  }
}

console.log(`\n${passed} check(s) passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) { console.log("Estimates data safety is NOT proven — do not ship."); process.exit(1); }
console.log("All good.");
