import { ChevronDown, ChevronRight } from "lucide-react";
import { rateKey, money2, lookupRate, computeRowTotal, autoMinimumCartage, autoConcreteSurcharge, autoEnvironmentLevy, autoReinforcementByRate } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

/**
 * Renders EVERY product in one catalog category as a line item, applicable
 * or not — this is the "roll everything down" behaviour the estimator asked for.
 * Nothing here should filter products by element type; if a category
 * shouldn't apply to a given job, the estimator just leaves those rows
 * blank (blank quantities cost nothing — see computeElementCost).
 */
export default function CategoryBlock({ cat, item, rates, onQtyChange, onRateChange, catOpen, toggleCat, catTotal }) {
  const hasWeight = cat.products.some((p) => p.unitWeight != null);
  const hasArea = !!cat.areaBasis;
  const hasLength = !!cat.lengthBasis;
  // A last delivered load under 4 m³ auto-applies Minimum cartage (amber ghost on its
  // row, like the crew sheet) — typing a Qty there takes the row manual.
  const minCartage = cat.key === "CONCRETE" ? autoMinimumCartage(item, rates) : null;
  // The production & transport surcharge auto-applies per m³ to the whole
  // poured volume ($2.59/m³ default) — same amber-ghost treatment.
  const surcharge = cat.key === "CONCRETE" ? autoConcreteSurcharge(item, rates) : null;
  const levy = cat.key === "CONCRETE" ? autoEnvironmentLevy(item, rates) : null;
  // Reinforcement derived from the element's kg/m³ rate rather than a bar
  // takeoff — same ghost-quantity treatment as the concrete fees above.
  const reoRate = cat.key === "PROCESSED BAR" ? autoReinforcementByRate(item, rates) : null;
  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={toggleCat}
        className="w-full flex items-center justify-between px-3 py-2 bg-neutral-800 text-white text-xs font-semibold tracking-wide uppercase hover:bg-neutral-700 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {catOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {cat.label}
        </span>
        <span className="font-mono tabular-nums normal-case font-semibold text-orange-300">
          {money2(catTotal)}
        </span>
      </button>
      {catOpen && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 font-medium">Product</th>
                <th className="text-left px-2 py-1.5 font-medium">Unit</th>
                <th className="text-right px-2 py-1.5 font-medium w-24">Qty</th>
                {hasArea && <th className="text-right px-2 py-1.5 font-medium w-20">Sheets</th>}
                {hasLength && <th className="text-right px-2 py-1.5 font-medium w-20">Bars</th>}
                {hasWeight && <th className="text-right px-2 py-1.5 font-medium w-20">Wt (kg)</th>}
                {hasWeight && <th className="text-right px-2 py-1.5 font-medium w-20">Total (t)</th>}
                <th className="text-right px-2 py-1.5 font-medium w-24">Unit $</th>
                <th className="text-right px-3 py-1.5 font-medium w-28">Total $</th>
              </tr>
            </thead>
            <tbody>
              {cat.products.map((p) => {
                const qKey = rateKey(cat.key, p.name, p.unit);
                const rate = lookupRate(rates, qKey, { unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength });
                const qty = Number(item.qtys[qKey]) || 0;
                const sheets = hasArea && rate.sheetArea ? Math.ceil(qty / rate.sheetArea) : null;
                const bars = hasLength && rate.barLength ? Math.ceil(qty / rate.barLength) : null;
                const totalWeight = rate.unitWeight
                  ? ((sheets != null ? sheets : bars != null ? bars : qty) * rate.unitWeight) / 1000
                  : null;
                const isAutoCartage = minCartage && minCartage.key === qKey;
                const isAutoSur = surcharge && surcharge.key === qKey;
                const isAutoLevy = levy && levy.key === qKey;
                const isAutoReo = reoRate && reoRate.key === qKey;
                const autoRow = isAutoCartage ? minCartage : isAutoSur ? surcharge
                  : isAutoLevy ? levy : isAutoReo ? { ...reoRate, qty: reoRate.tonnes.toFixed(3) } : null;
                const rowTotal = autoRow ? autoRow.total : computeRowTotal(cat, rate, qty);
                const filled = qty > 0 || !!autoRow;
                return (
                  <tr key={qKey} className={`border-t border-neutral-100 ${filled ? "bg-orange-50/40" : ""}`}>
                    <td className="px-3 py-1 text-neutral-700">
                      {p.name}
                      {isAutoCartage && (
                        <span
                          className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                          title={`${minCartage.loads} load${minCartage.loads === 1 ? "" : "s"}; the last delivers ${minCartage.lastLoad} m³, ${minCartage.qty} m³ short of the 4 m³ minimum. Type a quantity to price a known delivery split instead.`}
                        >
                          auto — {minCartage.qty} m³ short on the last load
                        </span>
                      )}
                      {isAutoSur && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">auto — per m³ of concrete</span>}
                      {isAutoLevy && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">auto — per m³ of concrete</span>}
                      {isAutoReo && (
                        <span
                          className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                          title={`${reoRate.volume.toFixed(2)} m³ of concrete at ${reoRate.ratePerM3} kg/m³. Type a tonnage to bill a real bar schedule instead.`}
                        >
                          auto — {reoRate.ratePerM3} kg/m³ × {reoRate.volume.toFixed(2)} m³
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-400">{p.unit}</td>
                    <td className="px-2 py-1">
                      <NumInput
                        value={item.qtys[qKey]}
                        placeholder={autoRow ? String(autoRow.qty) : undefined}
                        className={autoRow ? "placeholder:text-amber-800 placeholder:opacity-100 placeholder:font-semibold border-amber-400" : ""}
                        onChange={(v) => onQtyChange(qKey, v)}
                      />
                    </td>
                    {hasArea && (
                      <td className="px-2 py-1 text-right font-mono text-neutral-400 tabular-nums">
                        {sheets != null && qty > 0 ? sheets : "—"}
                      </td>
                    )}
                    {hasLength && (
                      <td className="px-2 py-1 text-right font-mono text-neutral-400 tabular-nums">
                        {bars != null && qty > 0 ? bars : "—"}
                      </td>
                    )}
                    {hasWeight && (
                      <td className="px-2 py-1 text-right font-mono text-neutral-400 tabular-nums">
                        {rate.unitWeight != null ? rate.unitWeight : "—"}
                      </td>
                    )}
                    {hasWeight && (
                      <td className="px-2 py-1 text-right font-mono text-neutral-400 tabular-nums">
                        {totalWeight != null && qty > 0 ? totalWeight.toFixed(3) : "—"}
                      </td>
                    )}
                    <td className="px-2 py-1 text-right font-mono text-neutral-500 tabular-nums">
                      {/* Editable-in-place rates, saved to the same
                          rates-library key the Rates modal shows (one figure,
                          everywhere): the small-load charge, and every
                          "quote"-unit row — those are subcontract items whose
                          price IS the quote received, so the estimator types
                          the quoted amount straight onto the row (qty 1 books
                          the whole quote). */}
                      {onRateChange && ((cat.key === "CONCRETE" && (/minimum cartage|small load/i.test(p.name) || /transport surcharge/i.test(p.name) || /environment levy/i.test(p.name))) || p.unit === "quote") ? (
                        <NumInput
                          step={p.unit === "quote" ? "50" : "0.25"}
                          value={rate.unitCost}
                          placeholder={p.unit === "quote" ? "quote $" : undefined}
                          onChange={(v) => onRateChange(qKey, v, p.unitCost ?? 0)}
                        />
                      ) : (
                        money2(rate.unitCost)
                      )}
                    </td>
                    <td className={`px-3 py-1 text-right font-mono tabular-nums font-medium ${filled ? "text-neutral-900" : "text-neutral-300"}`}>
                      {/* Subcontract "quote" rows: the TOTAL itself is where
                          the received quote lands — type the contractor's
                          figure straight in (qty books as 1, the rate becomes
                          the quote); clear it to zero the row again. */}
                      {p.unit === "quote" && onRateChange ? (
                        <NumInput
                          step="50"
                          value={qty > 0 ? rowTotal : undefined}
                          placeholder="quote $"
                          onChange={(v) => {
                            const n = Number(v);
                            if (v === undefined || v === "" || !Number.isFinite(n)) {
                              onQtyChange(qKey, undefined);
                            } else {
                              const q = qty > 0 ? qty : 1;
                              if (!(qty > 0)) onQtyChange(qKey, 1);
                              onRateChange(qKey, n / q, p.unitCost ?? 0);
                            }
                          }}
                        />
                      ) : (
                        money2(rowTotal)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
