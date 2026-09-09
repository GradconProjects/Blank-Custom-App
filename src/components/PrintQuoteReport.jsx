import {
  CATEGORY_ORDER, SECTION_ORDER, FULL_CATALOG, RESOURCE_COLS,
} from "../data/catalog.js";
import {
  computeElementCost, computeGrandTotal, computeMarginLadder, rateKey, lookupRate, computeRowTotal, rowContext, money, money2, getDefaultMargin, getMarginSteps, autoMinimumCartage, autoConcreteSurcharge, autoEnvironmentLevy,
} from "../lib/costing.js";
import { BOMA_LOGO_DATA_URI } from "../lib/logo.js";

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
// Portal Settings "PDF / print page orientation" — read at render time so a
// changed setting applies to the very next print, and it STAYS applied (the
// preference persists; the page never falls back to portrait on its own).
function pageOrientation() {
  try {
    const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
    return p.pageOrientation === "landscape" ? "landscape" : "portrait";
  } catch {
    return "portrait";
  }
}

export default function PrintQuoteReport({ quote, items, rates, categoryOrder = CATEGORY_ORDER, sectionOrder = SECTION_ORDER, visible = false, onClose, isPrintTarget = true }) {
  return (
    <>
      {isPrintTarget && (
        <div className="hidden print:block text-black text-[11px]">
          {/* overrides index.css's default `@page { size: A4 }` */}
          <style>{`@media print { @page { size: A4 ${pageOrientation()}; } }`}</style>
          <ReportContent quote={quote} items={items} rates={rates} categoryOrder={categoryOrder} sectionOrder={sectionOrder} />
        </div>
      )}
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
    grandTotal, quote.overheadPct, quote.contingencyPct, quote.gfa, getMarginSteps()
  );

  return (
    <>
      <div className="border-b-2 border-black pb-2 mb-3">
        <img src={BOMA_LOGO_DATA_URI} alt="BOMA ESTIMATES" className="h-16 mb-1.5" />
        <div className="text-xl font-bold">{quote.projectName || "Untitled project"}</div>
        {quote.clientName && <div className="text-neutral-700">Client: {quote.clientName}</div>}
        <div className="text-neutral-600">Date: {quote.projectDate}</div>
      </div>

      {categoryOrder.map((category) => {
        const catItems = items.filter((it) => it.category === category);
        if (catItems.length === 0) return null;
        return (
          <div key={category} className="mb-3">
            <div className="text-xs font-bold uppercase tracking-wide bg-blue-900 text-white px-2 py-1">{category}</div>
            {sectionOrder.map((section) => {
              const secItems = catItems.filter((it) => it.section === section);
              if (secItems.length === 0) return null;
              return (
                <div key={section} className="pl-2">
                  <div className="text-[10px] uppercase tracking-wide text-blue-900 font-semibold bg-blue-50 px-2 py-0.5 mt-1">
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

      {/* What the estimate assumed, recorded under Project Geometry. Printed
          straight after the total so the figure and its qualifications are
          never separated — a price without them is not defensible weeks on. */}
      {(quote.assumptions || []).some((a) => (a.text || "").trim()) && (
        <div className="mt-3 break-inside-avoid">
          <div className="text-xs font-bold uppercase tracking-wide bg-blue-900 text-white px-2 py-1">Assumptions</div>
          <ol className="px-4 py-1 list-decimal space-y-0.5">
            {(quote.assumptions || [])
              .filter((a) => (a.text || "").trim())
              .map((a) => <li key={a.id}>{a.text}</li>)}
          </ol>
        </div>
      )}

      <div className="mt-3 break-inside-avoid">
        <div className="text-xs font-bold uppercase tracking-wide bg-blue-900 text-white px-2 py-1">GFA &amp; On-Costs</div>
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
        <div className="text-xs font-bold uppercase tracking-wide bg-blue-900 text-white px-2 py-1">Margin Ladder</div>
        <table className="w-full text-[11px] mt-1">
          <thead>
            <tr className="text-left bg-blue-50 text-blue-900">
              <th className="py-1 px-1">Margin</th>
              <th className="py-1 px-1 text-right">= Markup on cost</th>
              <th className="py-1 px-1 text-right">Sell (ex GST)</th>
              <th className="py-1 px-1 text-right">Sell (inc GST)</th>
              <th className="py-1 px-1 text-right">$/m² GFA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.margin}
                className={`border-b border-neutral-200 ${Math.abs(row.margin - getDefaultMargin()) < 1e-9 ? "font-bold" : ""}`}
              >
                <td className="py-0.5">{Math.round(row.margin * 100)}%</td>
                <td className="py-0.5 text-right">{(row.markupOnCost * 100).toFixed(1)}%</td>
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
  const ctx = rowContext(item);
  FULL_CATALOG.forEach((cat) => {
    cat.products.forEach((p) => {
      const qKey = rateKey(cat.key, p.name, p.unit);
      const qty = Number(item.qtys[qKey]) || 0;
      if (qty > 0) {
        const rate = lookupRate(rates, qKey, { unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength });
        const rowTotal = computeRowTotal(cat, rate, qty, ctx);
        materialLines.push({ key: qKey, label: `${p.name} (${cat.key})`, qty, unit: p.unit, total: rowTotal });
      }
    });
  });

  // the auto small-load charge is real money in the totals, so the report
  // must show the line even though its Qty cell on screen is only a ghost
  const minCartage = autoMinimumCartage(item, rates);
  if (minCartage) {
    materialLines.push({ key: `${minCartage.key}::auto`, label: `Minimum cartage (CONCRETE — auto, last load ${minCartage.lastLoad} m³, ${minCartage.qty} m³ short of 4 m³)`, qty: minCartage.qty, unit: "m3", total: minCartage.total });
  }
  const levy = autoEnvironmentLevy(item, rates);
  if (levy) {
    materialLines.push({ key: `${levy.key}::auto`, label: "Environment levy (CONCRETE — auto, per m³)", qty: levy.qty, unit: "m3", total: levy.total });
  }
  const surcharge = autoConcreteSurcharge(item, rates);
  if (surcharge) {
    materialLines.push({ key: `${surcharge.key}::auto`, label: "Production & transport surcharge (CONCRETE — auto, per m³)", qty: surcharge.qty, unit: "m3", total: surcharge.total });
  }

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
      {item.description && (
        <div className="pl-2 text-neutral-600 italic whitespace-pre-wrap py-0.5">{item.description}</div>
      )}
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
      {(item.markups || []).map((m) =>
        m.type === "image" ? (
          <div key={m.id} className="pl-2 mt-1 break-inside-avoid">
            <div className="text-[9px] uppercase tracking-wide text-neutral-500">Markup: {m.name}</div>
            {/* saved rotation applies here too; a 90°/270° image is bounded on
                both axes so the rotated result can't spill over the page */}
            <img
              src={m.dataURL}
              alt={m.name}
              className={`object-contain border border-neutral-300 ${((m.rotation || 0) % 180 !== 0) ? "max-h-56 max-w-56" : "max-h-64 max-w-full"}`}
              style={{ transform: `rotate(${m.rotation || 0}deg)` }}
            />
          </div>
        ) : (
          // PDF markups can't be inlined by the print engine — list them so the
          // reader knows a marked-up drawing exists alongside this line item.
          <div key={m.id} className="pl-2 text-neutral-500 text-[10px]">
            Markup attached (PDF): {m.name}
          </div>
        )
      )}
    </div>
  );
}
