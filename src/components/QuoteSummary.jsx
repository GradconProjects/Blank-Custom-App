import { useMemo } from "react";
import { CATEGORY_ORDER, SECTION_ORDER } from "../data/catalog.js";
import { computeElementCost, computeGrandTotal, computeMarginLadder, money, money2, getDefaultMargin, getMarginSteps } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

export default function QuoteSummary({
  items, onReorder, rates, categoryOrder = CATEGORY_ORDER, sectionOrder = SECTION_ORDER,
  gfa, setGfa, overheadPct, setOverheadPct, contingencyPct, setContingencyPct,
}) {
  // Folded two levels deep — category (Foundations, Suspended Structure...)
  // then section within it — matching the Add-Element dropdown's grouping.
  const byCategory = useMemo(() => {
    const cats = {};
    categoryOrder.forEach((c) => { cats[c] = {}; });
    items.forEach((it) => {
      const cost = computeElementCost(it, rates);
      cats[it.category] = cats[it.category] || {};
      cats[it.category][it.section] = cats[it.category][it.section] || [];
      cats[it.category][it.section].push({ item: it, total: cost.total });
    });
    return cats;
  }, [items, rates, categoryOrder]);

  const grandTotal = useMemo(() => computeGrandTotal(items, rates), [items, rates]);
  const { subtotal, rows } = useMemo(
    () => computeMarginLadder(grandTotal, overheadPct, contingencyPct, gfa, getMarginSteps()),
    [grandTotal, overheadPct, contingencyPct, gfa]
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-neutral-900 text-white px-4 py-2 text-xs font-semibold uppercase tracking-wide">
          Quote Summary
        </div>
        <div className="p-3 max-h-[40vh] overflow-y-auto space-y-3">
          {categoryOrder.filter((c) => Object.values(byCategory[c] || {}).some((rows) => rows.length)).map((category) => {
            const sections = byCategory[category];
            const catTotal = Object.values(sections).flat().reduce((s, r) => s + r.total, 0);
            return (
              <div key={category}>
                <div className="text-[11px] uppercase tracking-widest text-neutral-600 font-bold">{category}</div>
                {sectionOrder.filter((s) => sections[s]?.length).map((section) => (
                  <div key={section} className="pl-2 mt-1">
                    <div className="text-[10px] uppercase tracking-widest text-neutral-400 font-semibold">{section}</div>
                    {sections[section].map((r) => (
                      <div
                        key={r.item.id}
                        draggable={!!onReorder}
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", r.item.id); }}
                        onDragOver={(e) => { if (onReorder) e.preventDefault(); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const draggedId = e.dataTransfer.getData("text/plain");
                          if (draggedId && onReorder) onReorder(draggedId, r.item.id);
                        }}
                        className={`flex justify-between text-[13px] py-0.5 ${onReorder ? "cursor-grab active:cursor-grabbing hover:bg-neutral-50 rounded" : ""}`}
                        title={onReorder ? "Drag to reorder" : undefined}
                      >
                        <span className="text-neutral-600 truncate pr-2">{r.item.label}</span>
                        <span className="font-mono tabular-nums text-neutral-800 flex-none">{money2(r.total)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="flex justify-between text-[12px] font-semibold border-t border-neutral-100 mt-1 pt-1">
                  <span className="text-neutral-500">Subtotal</span>
                  <span className="font-mono tabular-nums text-neutral-700">{money2(catTotal)}</span>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="text-sm text-neutral-400 text-center py-6">No elements added yet.</div>
          )}
        </div>
        <div className="px-4 py-3 bg-neutral-900 text-white flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide">Grand Total (ex GST)</span>
          <span className="font-mono tabular-nums text-xl font-bold text-orange-400">{money2(grandTotal)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">GFA &amp; on-costs</div>
        <label className="flex items-center justify-between text-[13px]">
          Total GFA (m²)
          <NumInput value={gfa} onChange={setGfa} className="w-28" step="0.1" />
        </label>
        <label className="flex items-center justify-between text-[13px]">
          Overheads %
          <NumInput value={overheadPct} onChange={setOverheadPct} className="w-28" step="0.01" />
        </label>
        <label className="flex items-center justify-between text-[13px]">
          Contingency %
          <NumInput value={contingencyPct} onChange={setContingencyPct} className="w-28" step="0.01" />
        </label>
        <div className="flex justify-between text-[13px] font-semibold pt-1 border-t border-neutral-100">
          <span className="text-neutral-500">Subtotal (+ OH + Cont.)</span>
          <span className="font-mono tabular-nums">{money2(subtotal)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-neutral-900 text-white px-4 py-2 text-xs font-semibold uppercase tracking-wide">
          Margin Ladder
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500 text-[10px] uppercase tracking-wide">
              <th className="text-left px-3 py-1.5 font-medium">Margin</th>
              <th className="text-right px-2 py-1.5 font-medium" title="What you add to COST to land the margin on the left. They are not the same number — a 25% margin needs 33.3% on cost.">= Markup on cost</th>
              <th className="text-right px-2 py-1.5 font-medium">Sell (ex GST)</th>
              <th className="text-right px-2 py-1.5 font-medium">Sell (inc GST)</th>
              <th className="text-right px-3 py-1.5 font-medium">$/m² GFA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isDefault = Math.abs(row.margin - getDefaultMargin()) < 1e-9;
              return (
                <tr key={row.margin} className={`border-t border-neutral-100 ${isDefault ? "bg-emerald-50" : ""}`}>
                  <td className="px-3 py-1 font-medium text-neutral-700">{Math.round(row.margin * 100)}%</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-500">
                    {(row.markupOnCost * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{money(row.sellExGst)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{money(row.sellIncGst)}</td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">
                    {row.perM2 > 0 ? money2(row.perM2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
