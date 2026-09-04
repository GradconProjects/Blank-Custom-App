import { X } from "lucide-react";
import { FULL_CATALOG, RESOURCE_COLS, PRODUCTION_RATES } from "../data/catalog.js";
import { rateKey } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

export default function RatesModal({ rates, setRates, onClose }) {
  const update = (key, field, value) =>
    setRates((r) => ({ ...r, [key]: { ...r[key], [field]: value === "" ? null : Number(value) } }));

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
          <h2 className="font-semibold text-neutral-800">Rates — edit the catalog</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={20} /></button>
        </div>
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
                          <NumInput value={r.unitCost} onChange={(v) => update(k, "unitCost", v)} />
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
