import {
  CATEGORY_ORDER, SECTION_ORDER, FULL_CATALOG, RESOURCE_COLS, MARGIN_STEPS, DEFAULT_MARGIN,
} from "../data/catalog.js";
import {
  computeElementCost, computeGrandTotal, computeMarginLadder, rateKey, lookupRate, computeRowTotal, money, money2,
} from "../lib/costing.js";

/**
 * Print/PDF export — the "window.print() + @media print stylesheet" approach
 * CLAUDE.md flags as the cheapest way to add this. Deliberately NOT a
 * printout of the on-screen editable UI: that would either (a) only show
 * whatever categories/cards happen to be expanded on screen (they're
 * conditionally unmounted when collapsed, so CSS alone can't reveal them),
 * or (b) print all 114 catalog products per element regardless, which is
 * useless for a client-facing quote. Instead this is a standalone report,
 * built straight from computeElementCost, that lists only the lines an
 * estimator actually filled in.
 *
 * Two render paths share the same ReportContent: a `hidden print:block` copy
 * (what actually prints — invisible on screen, shown only under `@media
 * print`) and an on-screen preview modal (`visible` prop, from the Print/PDF
 * button in App.jsx). The modal exists because `window.print()` can be
 * silently blocked when this app is embedded in a sandboxed iframe (e.g.
 * hosted inside the portal shell inside an Artifact preview) — there's no
 * reliable way to detect that failure, so the button always opens this
 * preview too, telling the estimator to use their browser's own Print
 * command (Ctrl+P/Cmd+P), which works even when the script-triggered dialog
 * doesn't.
 */
export default function PrintQuoteReport({ quote, items, rates, categoryOrder = CATEGORY_ORDER, sectionOrder = SECTION_ORDER, visible = false, onClose }) {
  return (
    <>
      <div className="hidden print:block text-black text-[11px]">
        <ReportContent quote={quote} items={items} rates={rates} categoryOrder={categoryOrder} sectionOrder={sectionOrder} />
      </div>
      {visible && (
        <div className="print:hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-neutral-200 bg-amber-50 rounded-t-xl">
              <div className="text-[13px] text-neutral-800">
                <b>Print preview.</b> If the print dialog didn't open on its own (this preview's sandbox can silently
                block it), use your browser's own Print command now — <kbd className="px-1 py-0.5 bg-white border border-neutral-300 rounded text-[11px]">Ctrl+P</kbd> (Windows)
                or <kbd className="px-1 py-0.5 bg-white border border-neutral-300 rounded text-[11px]">Cmd+P</kbd> (Mac), or the browser menu — then choose
                "Save as PDF" for a file instead of a physical printout.
              </div>
              <button
                onClick={onClose}
                className="flex-none px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-900 text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto p-6 text-black text-[11px]">
              <ReportContent quote={quote} items={items} rates={rates} categoryOrder={categoryOrder} sectionOrder={sectionOrder} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReportContent({ quote, items, rates, categoryOrder, sectionOrder }) {
  const grandTotal = computeGrandTotal(items, rates);
  const { subtotal, rows } = computeMarginLadder(
    grandTotal, quote.overheadPct, quote.contingencyPct, quote.gfa, MARGIN_STEPS
  );

  return (
    <>
      <div className="border-b-2 border-black pb-2 mb-3">
        <div className="text-[10px] uppercase tracking-widest text-neutral-600 font-semibold">
          BOMA ESTIMATES
        </div>
        <div className="text-xl font-bold">{quote.projectName || "Untitled project"}</div>
        <div className="text-neutral-600">Date: {quote.projectDate}</div>
      </div>

      {categoryOrder.map((category) => {
        const catItems = items.filter((it) => it.category === category);
        if (catItems.length === 0) return null;
        return (
          <div key={category} className="mb-3">
            <div className="text-xs font-bold uppercase tracking-wide bg-neutral-200 px-2 py-1">{category}</div>
            {sectionOrder.map((section) => {
              const secItems = catItems.filter((it) => it.section === section);
              if (secItems.length === 0) return null;
              return (
                <div key={section} className="pl-2">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500 font-semibold mt-1">
                    {section}
                  </div>
                  {secItems.map((item) => (
                    <ElementReportBlock key={item.id} item={item} rates={rates} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="mt-4 border-t-2 border-black pt-2 flex justify-between text-sm font-bold break-inside-avoid">
        <span>Grand Total (ex GST)</span>
        <span>{money2(grandTotal)}</span>
      </div>

      <div className="mt-3 break-inside-avoid">
        <div className="text-xs font-bold uppercase tracking-wide bg-neutral-200 px-2 py-1">GFA &amp; On-Costs</div>
        <div className="px-2 py-1 flex justify-between">
          <span>Total GFA</span><span>{quote.gfa ? `${quote.gfa} m²` : "—"}</span>
        </div>
        <div className="px-2 py-1 flex justify-between">
          <span>Overheads</span><span>{Math.round((Number(quote.overheadPct) || 0) * 100)}%</span>
        </div>
        <div className="px-2 py-1 flex justify-between">
          <span>Contingency</span><span>{Math.round((Number(quote.contingencyPct) || 0) * 100)}%</span>
        </div>
        <div className="px-2 py-1 flex justify-between font-semibold border-t border-neutral-300">
          <span>Subtotal</span><span>{money2(subtotal)}</span>
        </div>
      </div>

      <div className="mt-3 break-inside-avoid">
        <div className="text-xs font-bold uppercase tracking-wide bg-neutral-200 px-2 py-1">Margin Ladder</div>
        <table className="w-full text-[11px] mt-1">
          <thead>
            <tr className="text-left border-b border-neutral-400">
              <th className="py-1">Margin</th>
              <th className="py-1 text-right">Sell (ex GST)</th>
              <th className="py-1 text-right">Sell (inc GST)</th>
              <th className="py-1 text-right">$/m² GFA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.margin}
                className={`border-b border-neutral-200 ${Math.abs(row.margin - DEFAULT_MARGIN) < 1e-9 ? "font-bold" : ""}`}
              >
                <td className="py-0.5">{Math.round(row.margin * 100)}%</td>
                <td className="py-0.5 text-right">{money(row.sellExGst)}</td>
                <td className="py-0.5 text-right">{money(row.sellIncGst)}</td>
                <td className="py-0.5 text-right">{row.perM2 > 0 ? money2(row.perM2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ElementReportBlock({ item, rates }) {
  const cost = computeElementCost(item, rates);

  const materialLines = [];
  FULL_CATALOG.forEach((cat) => {
    cat.products.forEach((p) => {
      const qKey = rateKey(cat.key, p.name, p.unit);
      const qty = Number(item.qtys[qKey]) || 0;
      if (qty > 0) {
        const rate = lookupRate(rates, qKey, { unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength });
        const rowTotal = computeRowTotal(cat, rate, qty);
        materialLines.push({ key: qKey, label: `${p.name} (${cat.key})`, qty, unit: p.unit, total: rowTotal });
      }
    });
  });

  const labourLines = RESOURCE_COLS.filter((res) => cost.resourceTotals[res.key] > 0).map((res) => ({
    key: res.key,
    label: res.name,
    qty: cost.resourceTotals[res.key],
    unit: res.unit,
    total: cost.resourceCosts[res.key],
  }));

  const customLines = item.additional.filter((a) => (Number(a.qty) || 0) > 0 && a.name);
  const noLines = materialLines.length === 0 && labourLines.length === 0 && customLines.length === 0;

  return (
    <div className="mb-2 break-inside-avoid">
      <div className="flex justify-between font-semibold border-b border-neutral-300 py-0.5">
        <span>{item.label}</span>
        <span>{money2(cost.total)}</span>
      </div>
      {[...materialLines, ...labourLines].map((l) => (
        <div key={l.key} className="flex justify-between pl-2 text-neutral-700">
          <span>{l.label} — {l.qty.toLocaleString("en-AU", { maximumFractionDigits: 2 })} {l.unit}</span>
          <span>{money2(l.total)}</span>
        </div>
      ))}
      {customLines.map((a) => (
        <div key={a.id} className="flex justify-between pl-2 text-neutral-700">
          <span>{a.name} — {a.qty} {a.unit}</span>
          <span>{money2((Number(a.qty) || 0) * (Number(a.rate) || 0))}</span>
        </div>
      ))}
      {noLines && <div className="pl-2 text-neutral-400 italic">No quantities entered</div>}
    </div>
  );
}
