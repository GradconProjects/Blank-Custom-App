/* BOMA ESTIMATES — orders, procurement rounding, pour schedule and
 * reconciliation (Phase 5 of the UX redesign, brief §12 "Orders and exports").
 *
 * PURE and DOM-free on purpose, exactly like estimates-schema.js: inlined into
 * estimates-app.html by scripts/assemble-portal.mjs AND run in plain Node by
 * scripts/verify-estimates.mjs against real takeoffs in tests/fixtures/.
 *
 * Everything here is a VIEW of the Quantity Register lines the calculators
 * already produce (`inst.results.lines`). Nothing in this file measures
 * anything: it groups, rounds and totals. Three quantities are kept apart on
 * every order line and never merged:
 *   net       — the measured quantity (`line.qty`, no allowances);
 *   adjusted  — waste- and lap-adjusted (`line.finalQty`, what the register
 *               totals and every export already show);
 *   order     — the adjusted quantity rounded UP by the material's visible
 *               procurement rule (whole stock lengths, whole sheets, supplier
 *               increments). The rule text travels with the row so a reader
 *               can see WHY the order figure differs from the register figure.
 * The register/export figure is always the adjusted one — the order quantity
 * is extra information for purchasing, not a replacement.
 *
 * The context object (`ctx`) carries the few project/catalog facts this file
 * must not hard-code: bar stock length, sheet area, the mass helpers and the
 * product tables. The app builds it from its own constants (`ordersCtx()`);
 * the Node suite builds an equivalent one by hand.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EPS = 1e-9;
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  /** Round UP to a step, tolerant of float noise (11.999999 → 12, not 12.2). */
  function roundUpTo(x, step) {
    x = num(x); step = num(step);
    if (x <= 0) return 0;
    if (step <= 0) return x;
    const n = Math.ceil(x / step - EPS);
    return Math.round(n * step * 1e6) / 1e6;
  }
  const ceilSafe = (x) => Math.ceil(num(x) - EPS);

  /** Group display order — the order an estimator reads a procurement list. */
  const GROUP_ORDER = ["Excavation", "Base/Blinding", "Vapour Barrier", "Concrete", "Reinforcement", "Connections", "Formwork", "Joints", "Finishes", "Allowances"];
  function groupRank(g) { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; }

  /** Default facts. The app overrides every one of these from its own constants. */
  function defaultCtx(ctx) {
    ctx = ctx || {};
    return {
      barStockMm: num(ctx.barStockMm) > 0 ? num(ctx.barStockMm) : 12000,
      trenchStockM: num(ctx.trenchStockM) > 0 ? num(ctx.trenchStockM) : 6,
      meshSheetAreaM2: num(ctx.meshSheetAreaM2) > 0 ? num(ctx.meshSheetAreaM2) : 14.4,
      meshSheetLengthM: num(ctx.meshSheetLengthM) > 0 ? num(ctx.meshSheetLengthM) : 6,
      concreteStepM3: num(ctx.concreteStepM3) > 0 ? num(ctx.concreteStepM3) : 0.2,
      isTrenchMesh: typeof ctx.isTrenchMesh === "function" ? ctx.isTrenchMesh : (m) => /TM$/i.test(String(m || "")),
      isSquareMesh: typeof ctx.isSquareMesh === "function" ? ctx.isSquareMesh : (m) => /^(SL|RL)\d+$/i.test(String(m || "")),
      massPerM: typeof ctx.massPerM === "function" ? ctx.massPerM : (dia) => (dia * dia) / 162,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Procurement rules — one per material kind, each with visible text.  */
  /* ------------------------------------------------------------------ */
  /**
   * Decide the procurement rule for a register line. Returns
   * { id, text, orderUnit, apply(adjustedQty, agg) → { order, stock } }
   * where `stock` is the whole-unit count (stock lengths, sheets) when the
   * rule buys whole units, else undefined.
   */
  function procurementRuleFor(line, ctx) {
    const c = defaultCtx(ctx);
    const g = line.materialGroup || "";
    const unit = line.unit || "";
    const mat = String(line.material || "");
    if (g === "Concrete" || (g === "Base/Blinding" && /concrete|blinding/i.test(mat))) {
      const step = c.concreteStepM3;
      return { id: "concrete", text: `Ordered in ${step} m³ steps, rounded up`, orderUnit: "m³",
        apply: (q) => ({ order: roundUpTo(q, step) }) };
    }
    if (g === "Reinforcement" || g === "Connections") {
      if (c.isTrenchMesh(mat) && (unit === "lm" || unit === "m")) {
        const L = c.trenchStockM;
        return { id: "trench", text: `Whole ${L} m trench-mesh lengths, rounded up`, orderUnit: "lengths",
          apply: (q) => { const n = ceilSafe(q / L); return { order: n, stock: n, orderM: n * L }; } };
      }
      if (c.isSquareMesh(mat) && unit === "m²") {
        const A = c.meshSheetAreaM2;
        return { id: "mesh", text: `Whole ${A} m² sheets (6.0 × 2.4 m), rounded up`, orderUnit: "sheets",
          apply: (q, agg) => { const n = agg && agg.sheets ? agg.sheets : ceilSafe(q / A); return { order: n, stock: n, orderM2: n * A }; } };
      }
      if (c.isSquareMesh(mat) && (unit === "lm" || unit === "m")) {
        const L = c.meshSheetLengthM;
        return { id: "strip", text: `Strips cut from ${L} m sheets — whole sheet lengths, rounded up`, orderUnit: "lengths",
          apply: (q) => { const n = ceilSafe(q / L); return { order: n, stock: n, orderM: n * L }; } };
      }
      if (unit === "m" || unit === "lm" || (unit === "no." && line.lengthM !== undefined)) {
        const L = c.barStockMm / 1000;
        return { id: "bar", text: `Whole ${L} m stock lengths, rounded up`, orderUnit: "lengths",
          apply: (q, agg) => { const m = agg && agg.lm !== undefined ? agg.lm : q; const n = ceilSafe(m / L); return { order: n, stock: n, orderM: n * L }; } };
      }
      return { id: "count", text: "Whole items, rounded up", orderUnit: unit || "no.",
        apply: (q) => ({ order: ceilSafe(q) }) };
    }
    if (g === "Formwork") {
      return { id: "area1", text: "m², rounded up to 0.1", orderUnit: "m²", apply: (q) => ({ order: roundUpTo(q, 0.1) }) };
    }
    if (g === "Excavation" || g === "Base/Blinding") {
      return { id: "bulk", text: "m³, rounded up to 0.5 (bulk / truck quantities)", orderUnit: unit || "m³", apply: (q) => ({ order: roundUpTo(q, 0.5) }) };
    }
    if (g === "Vapour Barrier") {
      return { id: "wholeM2", text: "m², rounded up to the whole metre", orderUnit: unit || "m²", apply: (q) => ({ order: roundUpTo(q, 1) }) };
    }
    if (unit === "no." || unit === "each" || unit === "sheets") {
      return { id: "count", text: "Whole items, rounded up", orderUnit: unit, apply: (q) => ({ order: ceilSafe(q) }) };
    }
    return { id: "asIs", text: "As measured (rounded up to 0.01)", orderUnit: unit, apply: (q) => ({ order: roundUpTo(q, 0.01) }) };
  }

  /* ------------------------------------------------------------------ */
  /* Order schedule — one line per product across the whole takeoff.     */
  /* ------------------------------------------------------------------ */
  /** Stable key: the Order Schedule's include ticks (PROJECT.orderExclude) are stored under it. */
  function orderKeyOf(line) { return line.materialGroup + "::" + line.material + "::" + line.unit; }

  /**
   * Aggregate register lines into order rows. Each row:
   * { key, group, material, unit, net, adjusted, order, orderUnit, rule, ruleId,
   *   kg, tonnes, stock, sheets, lm, elements:[ids], lines:n, manual:n }
   */
  function orderScheduleFrom(lines, ctx) {
    const agg = new Map();
    (lines || []).forEach((l) => {
      if (!l) return;
      if (!(num(l.finalQty) || num(l.weightKg))) return;
      const key = orderKeyOf(l);
      let e = agg.get(key);
      if (!e) {
        e = { key, group: l.materialGroup || "", material: l.material || "", unit: l.unit || "", net: 0, adjusted: 0, kg: 0, sheets: 0, lm: 0, elements: [], lines: 0, manual: 0, _line: l };
        agg.set(key, e);
      }
      e.net += num(l.qty);
      e.adjusted += num(l.finalQty);
      e.kg += num(l.weightKg);
      if (l.sheets !== undefined) e.sheets += num(l.sheets);
      // ligatures/stirrups are counted in no. but cut from bar stock — their metres feed the stock-length count
      if (l.unit === "m" || l.unit === "lm") e.lm += num(l.finalQty);
      else if (l.lengthM !== undefined) e.lm += num(l.lengthM);
      if (l.elementId && e.elements.indexOf(l.elementId) < 0) e.elements.push(l.elementId);
      e.lines += 1;
      if (l.manualOverride) e.manual += 1;
    });
    const rows = [...agg.values()].map((e) => {
      const rule = procurementRuleFor(e._line, ctx);
      const r = rule.apply(e.adjusted, e);
      delete e._line;
      return Object.assign(e, {
        order: r.order, orderUnit: rule.orderUnit, rule: rule.text, ruleId: rule.id,
        stock: r.stock, orderM: r.orderM, orderM2: r.orderM2,
        tonnes: e.kg / 1000,
      });
    });
    rows.sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group) || a.material.localeCompare(b.material, undefined, { numeric: true }) || a.unit.localeCompare(b.unit));
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* Reinforcement grouped by product with stock lengths / sheets.        */
  /* ------------------------------------------------------------------ */
  /**
   * { bars:[{product, dia, lm, kg, tonnes, stockLengths, stockLenM}],
   *   trench:[{product, lm, kg, tonnes, lengths, stockLenM}],
   *   strips:[{product, lm, kg, tonnes, lengths, stockLenM}],
   *   mesh:[{product, m2, sheets, sheetAreaM2}],
   *   totals:{kg, tonnes, stockLengths, trenchLengths, sheets} }
   */
  function reinforcementByProduct(lines, ctx) {
    const c = defaultCtx(ctx);
    const bars = new Map(), trench = new Map(), strips = new Map(), mesh = new Map();
    const get = (m, k, init) => { let e = m.get(k); if (!e) { e = init(); m.set(k, e); } return e; };
    (lines || []).forEach((l) => {
      if (!l || l.materialGroup !== "Reinforcement") return;
      const mat = String(l.material || "");
      const unit = l.unit || "";
      if (c.isTrenchMesh(mat) && (unit === "lm" || unit === "m")) {
        const e = get(trench, mat, () => ({ product: mat, lm: 0, kg: 0 }));
        e.lm += num(l.finalQty); e.kg += num(l.weightKg);
      } else if (c.isSquareMesh(mat) && unit === "m²") {
        const e = get(mesh, mat, () => ({ product: mat, m2: 0, sheets: 0 }));
        e.m2 += num(l.finalQty); e.sheets += l.sheets !== undefined ? num(l.sheets) : ceilSafe(num(l.finalQty) / c.meshSheetAreaM2);
      } else if (c.isSquareMesh(mat) && (unit === "lm" || unit === "m")) {
        const e = get(strips, mat, () => ({ product: mat, lm: 0, kg: 0 }));
        e.lm += num(l.finalQty); e.kg += num(l.weightKg);
      } else if (unit === "m" || unit === "lm") {
        const e = get(bars, mat, () => ({ product: mat, lm: 0, kg: 0 }));
        e.lm += num(l.finalQty); e.kg += num(l.weightKg);
      } else if (unit === "no." && (l.lengthM !== undefined || num(l.weightKg))) {
        const e = get(bars, mat, () => ({ product: mat, lm: 0, kg: 0 }));
        e.lm += num(l.lengthM); e.kg += num(l.weightKg);
      }
    });
    const stockLenM = c.barStockMm / 1000;
    const numSort = (a, b) => a.product.localeCompare(b.product, undefined, { numeric: true });
    const barsOut = [...bars.values()].map((e) => { const m = String(e.product).match(/(\d+)/); return Object.assign(e, { dia: m ? parseInt(m[1], 10) : null, tonnes: e.kg / 1000, stockLengths: ceilSafe(e.lm / stockLenM), stockLenM }); }).sort(numSort);
    const trenchOut = [...trench.values()].map((e) => Object.assign(e, { tonnes: e.kg / 1000, lengths: ceilSafe(e.lm / c.trenchStockM), stockLenM: c.trenchStockM })).sort(numSort);
    const stripsOut = [...strips.values()].map((e) => Object.assign(e, { tonnes: e.kg / 1000, lengths: ceilSafe(e.lm / c.meshSheetLengthM), stockLenM: c.meshSheetLengthM })).sort(numSort);
    const meshOut = [...mesh.values()].map((e) => Object.assign(e, { sheetAreaM2: c.meshSheetAreaM2 })).sort(numSort);
    const kg = barsOut.concat(trenchOut, stripsOut).reduce((s, e) => s + e.kg, 0);
    return {
      bars: barsOut, trench: trenchOut, strips: stripsOut, mesh: meshOut,
      totals: {
        kg, tonnes: kg / 1000,
        stockLengths: barsOut.reduce((s, e) => s + e.stockLengths, 0),
        trenchLengths: trenchOut.reduce((s, e) => s + e.lengths, 0),
        stripLengths: stripsOut.reduce((s, e) => s + e.lengths, 0),
        sheets: meshOut.reduce((s, e) => s + e.sheets, 0),
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Pour schedule — concrete by grade, planned pour and element.         */
  /* ------------------------------------------------------------------ */
  /**
   * `instances` supplies the pour/level/zone tags (inst.tags). Returns
   * [{ grade, net, adjusted, order, pours:[{ pour, net, adjusted, order,
   *    elements:[{ elementId, element, level, zone, net, adjusted, order, spec }] }] }]
   * Grades sorted numerically, pours alphabetically with "(unscheduled)" last.
   */
  function pourSchedule(lines, instances, ctx) {
    const c = defaultCtx(ctx);
    const tagOf = (id, k) => { const inst = (instances || []).find((i) => i && i.id === id); return inst && inst.tags && typeof inst.tags[k] === "string" ? inst.tags[k].trim() : ""; };
    const grades = new Map();
    (lines || []).forEach((l) => {
      if (!l || l.materialGroup !== "Concrete") return;
      if (!(num(l.finalQty) || num(l.qty))) return;
      const grade = l.material || "Concrete";
      const pour = tagOf(l.elementId, "pour") || "(unscheduled)";
      let g = grades.get(grade); if (!g) { g = { grade, net: 0, adjusted: 0, pours: new Map() }; grades.set(grade, g); }
      let p = g.pours.get(pour); if (!p) { p = { pour, net: 0, adjusted: 0, elements: new Map() }; g.pours.set(pour, p); }
      let e = p.elements.get(l.elementId); if (!e) { e = { elementId: l.elementId, element: l.element || l.elementId, level: tagOf(l.elementId, "level"), zone: tagOf(l.elementId, "zone"), net: 0, adjusted: 0, specs: [] }; p.elements.set(l.elementId, e); }
      e.net += num(l.qty); e.adjusted += num(l.finalQty); if (l.spec) e.specs.push(l.spec);
      p.net += num(l.qty); p.adjusted += num(l.finalQty);
      g.net += num(l.qty); g.adjusted += num(l.finalQty);
    });
    const gradeNum = (s) => { const m = String(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : 9999; };
    const pourSort = (a, b) => (a.pour === "(unscheduled)") - (b.pour === "(unscheduled)") || a.pour.localeCompare(b.pour, undefined, { numeric: true });
    return [...grades.values()].sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || a.grade.localeCompare(b.grade)).map((g) => ({
      grade: g.grade, net: g.net, adjusted: g.adjusted, order: roundUpTo(g.adjusted, c.concreteStepM3),
      pours: [...g.pours.values()].sort(pourSort).map((p) => ({
        pour: p.pour, net: p.net, adjusted: p.adjusted, order: roundUpTo(p.adjusted, c.concreteStepM3),
        elements: [...p.elements.values()].map((e) => ({ elementId: e.elementId, element: e.element, level: e.level, zone: e.zone, net: e.net, adjusted: e.adjusted, order: roundUpTo(e.adjusted, c.concreteStepM3), spec: e.specs.join("; ") })),
      })),
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Totals and reconciliation.                                           */
  /* ------------------------------------------------------------------ */
  /** The same headline totals every totals row in the app shows, from any set of lines. */
  function totalsOf(lines) {
    const t = { concreteM3: 0, reoKg: 0, formworkM2: 0, blindM3: 0, vapM2: 0, excM3: 0, spoilM3: 0, lines: 0 };
    (lines || []).forEach((l) => {
      if (!l) return;
      t.lines += 1;
      const q = num(l.finalQty);
      switch (l.materialGroup) {
        case "Concrete": t.concreteM3 += q; break;
        case "Reinforcement": t.reoKg += num(l.weightKg); break;
        case "Formwork": t.formworkM2 += q; break;
        case "Base/Blinding": t.blindM3 += q; break;
        case "Vapour Barrier": t.vapM2 += q; break;
        case "Excavation": if (/spoil disposal/i.test(String(l.material || ""))) t.spoilM3 += q; else t.excM3 += q; break;
        default: break;
      }
    });
    return t;
  }
  const METRICS = [
    ["concreteM3", "Concrete", "m³", 3],
    ["reoKg", "Reinforcement", "kg", 1],
    ["formworkM2", "Formwork", "m²", 2],
    ["blindM3", "Blinding / base", "m³", 3],
    ["vapM2", "Vapour barrier", "m²", 2],
    ["excM3", "Excavation", "m³", 3],
    ["spoilM3", "Spoil removal", "m³", 3],
    ["lines", "Quantity lines", "", 0],
  ];
  /** FNV-1a over the identifying, quantity-bearing part of every line — order-independent. */
  function linesFingerprint(lines) {
    const parts = (lines || []).map((l) => [l.elementId, l.overrideKey || (l.materialGroup + "|" + l.material + "|" + l.spec), Math.round(num(l.finalQty) * 1000)].join("~")).sort();
    const str = parts.join("\n");
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("00000000" + h.toString(16)).slice(-8);
  }
  /**
   * Compare several sources of "the same" lines. `sources` = [{ name, lines }];
   * the first is the reference. Returns { ok, rows:[{ key, label, unit, dp,
   * values:[…], ok }], fingerprints:[…], names:[…] }. Two totals agree when
   * they match to the metric's decimal places.
   */
  function reconcile(sources) {
    const names = sources.map((s) => s.name);
    const totals = sources.map((s) => totalsOf(s.lines));
    const rows = METRICS.map(([key, label, unit, dp]) => {
      const values = totals.map((t) => t[key]);
      const ref = values[0];
      const ok = values.every((v) => Math.abs(v - ref) < Math.pow(10, -dp) / 2 + EPS);
      return { key, label, unit, dp, values, ok };
    });
    const fingerprints = sources.map((s) => linesFingerprint(s.lines));
    const fpOk = fingerprints.every((f) => f === fingerprints[0]);
    rows.push({ key: "fingerprint", label: "Line fingerprint", unit: "", dp: 0, values: fingerprints, ok: fpOk });
    return { ok: rows.every((r) => r.ok), rows, fingerprints, names };
  }

  return {
    GROUP_ORDER,
    roundUpTo,
    defaultCtx,
    procurementRuleFor,
    orderKeyOf,
    orderScheduleFrom,
    reinforcementByProduct,
    pourSchedule,
    totalsOf,
    linesFingerprint,
    reconcile,
  };
});
