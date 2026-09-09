import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { FULL_CATALOG, RESOURCE_COLS, PRODUCTION_RATES } from "../data/catalog.js";
import { rateKey } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";
import { libraryGovernedKeys, readLibraryState } from "../lib/ratesLibrarySync.js";

export default function RatesModal({ rates, setRates, onClose }) {
  // Prices the Rates Library sets are shown, not edited, here: an edit would
  // be overwritten by the library on the next load anyway (the library
  // rules — see lib/ratesLibrarySync.js). Change them in the Rates Library.
  const governed = useMemo(() => libraryGovernedKeys(readLibraryState()), []);
  const update = (key, field, value) =>
    setRates((r) => ({ ...r, [key]: { ...r[key], [field]: value === "" ? null : Number(value) } }));

  // Every stored price that no longer matches the catalog it came from. A
  // browser seeds `boma-rates` with the WHOLE catalog on first save, so a
  // price corrected in catalog.js afterwards is invisible here until it is
  // restored — this is what makes that visible and fixable rather than a
  // silent disagreement between the element cards and the Rates Library.
  // Labour and production rates are included: they drift the same way.
  const drift = useMemo(() => {
    const out = [];
    FULL_CATALOG.forEach((cat) => cat.products.forEach((p) => {
      if (p.unitCost == null) return;
      const k = rateKey(cat.key, p.name, p.unit);
      const cur = rates[k] && rates[k].unitCost;
      if (cur != null && Number(cur) !== Number(p.unitCost)) out.push({ k, was: Number(cur), now: p.unitCost });
    }));
    RESOURCE_COLS.forEach((res) => {
      const k = rateKey("LABOUR", res.name, res.unit);
      const cur = rates[k] && rates[k].unitCost;
      if (cur != null && Number(cur) !== Number(res.rate)) out.push({ k, was: Number(cur), now: res.rate });
    });
    PRODUCTION_RATES.forEach((pr) => {
      const k = rateKey("PRODUCTION", pr.name, pr.unit);
      const cur = rates[k] && rates[k].unitCost;
      if (cur != null && Number(cur) !== Number(pr.rate)) out.push({ k, was: Number(cur), now: pr.rate });
    });
    return out;
  }, [rates]);

  // Two-click arm-then-confirm rather than window.confirm() — this overwrites
  // deliberate price edits, so it should never happen on one stray click.
  const [armed, setArmed] = useState(false);
  const restoreAll = () =>
    setRates((r) => {
      const next = { ...r };
      drift.forEach((d) => { next[d.k] = { ...(next[d.k] || {}), unitCost: d.now }; });
      return next;
    });

  // Weight/area/length-basis categories price by tonne/sheet/bar (see CLAUDE.md rule 2),
  // not by the unit the estimator actually types into the quote (m, m², m) — this backs
  // out that "what am I really paying per m/m²" figure from the catalog rate, and lets
  // editing it flow back into the real unitCost so Amount = Qty × Rate still holds.
  const unitRateOf = (cat, r) => {
    if (cat.weightBasis) return r.unitWeight ? (r.unitCost * r.unitWeight) / 1000 : null;
    if (cat.areaBasis) return r.sheetArea ? r.unitCost / r.sheetArea : null;
    if (cat.lengthBasis) return r.barLength ? r.unitCost / r.barLength : null;
    return null;
  };
  const updateUnitRate = (cat, key, r, value) => {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    if (cat.weightBasis) { if (r.unitWeight) update(key, "unitCost", (value * 1000) / r.unitWeight); return; }
    if (cat.areaBasis) { if (r.sheetArea) update(key, "unitCost", value * r.sheetArea); return; }
    if (cat.lengthBasis) { if (r.barLength) update(key, "unitCost", value * r.barLength); return; }
  };
  const unitRateLabel = (cat) =>
    cat.weightBasis ? "$/m" : cat.areaBasis ? "$/m²" : cat.lengthBasis ? "$/m" : null;
  // The "Base rate" column previously labeled itself off each product's own qty-entry
  // unit (cat.products[0]?.unit — "m" for Processed Bar/Stock Bar, "m2" for Square
  // Mesh), which is wrong: the base rate is genuinely priced per tonne/sheet/bar (see
  // CLAUDE.md rule 2), not per m/m². That mislabeled "$/m" next to Processed Bar's
  // $1930 figure (obviously not a sane per-metre price) — this labels it correctly so
  // the real per-tonne/per-sheet/per-bar rate is legible instead of looking like a typo.
  const baseRateLabel = (cat) =>
    cat.weightBasis ? "tonne" : cat.areaBasis ? "sheet" : cat.lengthBasis ? "bar" : cat.products[0]?.unit;

  // Stock Bar's base rate is genuinely $/bar (see CLAUDE.md rule 2 — it's costed
  // qty × unitCost, never off weight), but the real steel price it's built from is a
  // flat $/tonne rate (currently $1825/t) converted per diameter by weight — same idea
  // Processed Bar already shows directly as its own base rate. This surfaces that same
  // $/tonne figure for Stock Bar too, always visible and editable either direction, so
  // a steel price change can be entered once per diameter as $/t instead of doing the
  // weight maths by hand. Processed Bar/Square Mesh don't need this: Processed Bar's
  // base rate already IS $/tonne, and Square Mesh isn't priced by weight at all.
  const showsTonneRate = (cat) => cat.key === "STOCK BAR";
  const tonneRateOf = (r) => (r.unitWeight ? (r.unitCost * 1000) / r.unitWeight : null);
  const updateTonneRate = (key, r, value) => {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    if (r.unitWeight) update(key, "unitCost", (value * r.unitWeight) / 1000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
          <h2 className="font-semibold text-neutral-800">Rates — edit the BOMA catalog</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={20} /></button>
        </div>
        {/* A browser that has saved its rates keeps every price it saved, so a
            corrected catalog price never reaches it on its own (see
            CLAUDE.md "Change default prices"). Say so plainly, count the rows
            that differ, and offer one click to take the catalog's prices —
            that is how a corrected rate actually lands on an existing install. */}
        {drift.length > 0 && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-4">
            <div className="text-[12px] text-amber-900">
              <b>{drift.length} rate{drift.length === 1 ? "" : "s"} differ from the BOMA catalog.</b>{" "}
              Prices you have edited stay until you restore them. Use ↺ on a row for one, or restore them all.
            </div>
            <button
              onClick={() => {
                if (armed) { restoreAll(); setArmed(false); }
                else { setArmed(true); }
              }}
              className={`flex-none px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                armed ? "bg-red-600 hover:bg-red-700 text-white" : "bg-amber-800 hover:bg-amber-900 text-white"
              }`}
            >
              {armed ? `Confirm — overwrite ${drift.length}` : "Restore catalog prices"}
            </button>
          </div>
        )}
        <div className="overflow-y-auto p-4 space-y-4">
          {FULL_CATALOG.map((cat) => (
            <div key={cat.key}>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                {cat.label}
                {cat.areaBasis && <span className="normal-case font-normal text-neutral-400"> — qty entered in m², sheet area below controls the conversion</span>}
                {cat.lengthBasis && <span className="normal-case font-normal text-neutral-400"> — qty entered in m, bar length below controls the conversion</span>}
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
                    <th className="text-left font-medium pb-1">Product</th>
                    <th className="text-left font-medium pb-1 w-28">{cat.products.some((p) => p.unitWeight != null) ? "Weight (kg)" : ""}</th>
                    <th className="text-left font-medium pb-1 w-28">{cat.areaBasis ? "Sheet area (m²)" : cat.lengthBasis ? "Bar length (m)" : ""}</th>
                    <th className="text-left font-medium pb-1 w-28">Base rate ($/{baseRateLabel(cat)})</th>
                    {unitRateLabel(cat) && <th className="text-left font-medium pb-1 w-28">Unit rate ({unitRateLabel(cat)})</th>}
                    {showsTonneRate(cat) && <th className="text-left font-medium pb-1 w-28">Steel rate ($/tonne)</th>}
                  </tr>
                </thead>
                <tbody>
                  {cat.products.map((p) => {
                    const k = rateKey(cat.key, p.name, p.unit);
                    const r = rates[k] || { unitCost: p.unitCost, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength };
                    const unitRate = unitRateOf(cat, r);
                    return (
                      <tr key={k} className="border-t border-neutral-100">
                        <td className="py-1 pr-2 text-neutral-700">{p.name} <span className="text-neutral-400">({p.unit})</span></td>
                        {p.unitWeight != null ? (
                          <td className="py-1 pr-2 w-28">
                            <NumInput value={r.unitWeight} onChange={(v) => update(k, "unitWeight", v)} />
                          </td>
                        ) : <td className="w-28"></td>}
                        {cat.areaBasis ? (
                          <td className="py-1 pr-2 w-28">
                            <NumInput value={r.sheetArea} onChange={(v) => update(k, "sheetArea", v)} />
                          </td>
                        ) : cat.lengthBasis ? (
                          <td className="py-1 pr-2 w-28">
                            <NumInput value={r.barLength} onChange={(v) => update(k, "barLength", v)} />
                          </td>
                        ) : <td className="w-28"></td>}
                        <td className="py-1 pr-2 w-28">
                          <div className="flex items-center gap-1">
                            {governed.has(k) ? (
                              <div className="flex items-center gap-1.5" title="This price is set in the Rates Library and follows it automatically — change it there">
                                <span className="font-mono tabular-nums text-neutral-800">{r.unitCost}</span>
                                <span className="text-[9px] uppercase tracking-wide font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1 py-0.5">Rates Library</span>
                              </div>
                            ) : (
                              <NumInput value={r.unitCost} onChange={(v) => update(k, "unitCost", v)} />
                            )}
                            {p.unitCost != null && Number(r.unitCost) !== Number(p.unitCost) && (
                              <button
                                onClick={() => update(k, "unitCost", p.unitCost)}
                                title={`Catalog price is $${p.unitCost} — click to restore it`}
                                className="flex-none text-[11px] leading-none px-1 py-1 rounded text-amber-700 hover:bg-amber-100"
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        </td>
                        {unitRateLabel(cat) && (
                          <td className="py-1 pr-2 w-28">
                            <NumInput value={unitRate} onChange={(v) => updateUnitRate(cat, k, r, v)} />
                          </td>
                        )}
                        {showsTonneRate(cat) && (
                          <td className="py-1 w-28">
                            <NumInput value={tonneRateOf(r)} onChange={(v) => updateTonneRate(k, r, v)} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
              CREW WORK RATES
              <span className="normal-case font-normal text-neutral-400"> — how much work one crew-day covers (1 t of steel, 10 m³ poured, …). The crew sheet derives crew-days from these blocks with decimals kept (36 m³ = 3.6 crew-days); each row sets per crew / per person and its own men-per-crew, and crew columns price per person per man-day.</span>
            </div>
            <table className="w-full text-[13px]">
              <tbody>
                {PRODUCTION_RATES.map((pr) => {
                  const k = rateKey("PRODUCTION", pr.name, pr.unit);
                  const r = rates[k] || { unitCost: pr.rate };
                  return (
                    <tr key={k} className="border-t border-neutral-100">
                      <td className="py-1 pr-2 text-neutral-700">{pr.name} <span className="text-neutral-400">({pr.unit})</span></td>
                      <td className="py-1 w-28">
                        <NumInput value={r.unitCost} onChange={(v) => update(k, "unitCost", v)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">LABOUR &amp; EQUIPMENT</div>
            <table className="w-full text-[13px]">
              <tbody>
                {RESOURCE_COLS.map((res) => {
                  const k = rateKey("LABOUR", res.name, res.unit);
                  const r = rates[k] || { unitCost: res.rate };
                  return (
                    <tr key={k} className="border-t border-neutral-100">
                      <td className="py-1 pr-2 text-neutral-700">{res.name} <span className="text-neutral-400">({res.unit})</span></td>
                      <td className="py-1 w-28">
                        <NumInput value={r.unitCost} onChange={(v) => update(k, "unitCost", v)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
