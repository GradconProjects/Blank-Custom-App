import { ChevronDown, ChevronRight } from "lucide-react";
import { rateKey, money2, lookupRate, computeRowTotal } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

/**
 * Renders EVERY product in one catalog category as a line item, applicable
 * or not — this is the "roll everything down" behaviour Grady asked for.
 * Nothing here should filter products by element type; if a category
 * shouldn't apply to a given job, the estimator just leaves those rows
 * blank (blank quantities cost nothing — see computeElementCost).
 */
export default function CategoryBlock({ cat, item, rates, onQtyChange, catOpen, toggleCat, catTotal }) {
  const hasWeight = cat.products.some((p) => p.unitWeight != null);
  const hasArea = !!cat.areaBasis;
  const hasLength = !!cat.lengthBasis;
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
                const rowTotal = computeRowTotal(cat, rate, qty);
                const filled = qty > 0;
                return (
                  <tr key={qKey} className={`border-t border-neutral-100 ${filled ? "bg-orange-50/40" : ""}`}>
                    <td className="px-3 py-1 text-neutral-700">{p.name}</td>
                    <td className="px-2 py-1 text-neutral-400">{p.unit}</td>
                    <td className="px-2 py-1">
                      <NumInput value={item.qtys[qKey]} onChange={(v) => onQtyChange(qKey, v)} />
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
                      {money2(rate.unitCost)}
                    </td>
                    <td className={`px-3 py-1 text-right font-mono tabular-nums font-medium ${filled ? "text-neutral-900" : "text-neutral-300"}`}>
                      {money2(rowTotal)}
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
