import { useEffect } from "react";
import { uid, getGstRate } from "../lib/costing.js";
import { BOMA_LOGO_FULL_DATA_URI } from "../lib/logo.js";
import { newTenderQuote, seedTenderItems, computeTenderProjectSum } from "../lib/tenderQuoteDefaults.js";

const fmtMoney = (n) => `$${(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The TENDER QUOTE — a direct copy of BOMA's real quotation document
 * (logo header, Date / Attention / Project block, numbered Project Details
 * line items each with a right-aligned "$… + GST" price and up to FOUR dot
 * points, Additional Options, Drawings, Tender Notes, Inclusions, Specific
 * Exclusions, General exclusions, Specific Contractual Conditions and the
 * signature block). Unlike the Internal Quote this shows no cost breakdown
 * and — deliberately — NO markup drawings.
 *
 * EVERYTHING is editable. Line items seed once from the project's own quote
 * (title = element, price = that element's share of the real sell price,
 * dot points = the element's published estimating quantities — the figures
 * that came across from the Estimates tab), and a Reseed button pulls them
 * fresh whenever the quote changes; the boilerplate sections seed from
 * BOMA's real standard wording (lib/tenderQuoteDefaults.js).
 *
 * Same dual-render pattern as the other two documents: a `hidden
 * print:block` copy (only when this is the active print target — App.jsx's
 * printTarget) plus an on-screen editor with a live print preview, since
 * window.print() can be silently blocked in a sandboxed iframe.
 */
export default function TenderQuoteReport({ quote, items, rates, visible, onClose, onChange, isPrintTarget }) {
  const tq = quote.tenderQuote || newTenderQuote();
  const set = (field, value) => onChange({ ...tq, [field]: value });

  // First open: seed the line items from the quote + estimating quantities.
  useEffect(() => {
    if (visible && (!quote.tenderQuote || quote.tenderQuote.items == null)) {
      onChange({ ...tq, items: seedTenderItems(quote, items, rates) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const lineItems = tq.items || [];
  const setLineItems = (next) => set("items", next);
  const patchLine = (id, patch) => setLineItems(lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const patchPoint = (id, i, v) =>
    setLineItems(lineItems.map((l) => (l.id === id ? { ...l, points: l.points.map((p, j) => (j === i ? v : p)) } : l)));

  const opts = tq.additionalOptions || [];
  const setOpts = (next) => set("additionalOptions", next);

  return (
    <>
      {isPrintTarget && (
        <div className="hidden print:block text-black text-[11px]">
          <ReportContent quote={quote} tq={tq} />
        </div>
      )}
      {visible && (
        <div className="print:hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-neutral-200 bg-amber-50 rounded-t-xl">
              <div className="text-[13px] text-neutral-800">
                <b>Tender Quote — fully editable.</b> Line items are BUILDING LEVELS: elements grouped by the level
                named at the start of their label ("Ground Floor - …"), each priced as that level's share of the real
                sell price, dot points summarising the elements at that level from the estimating quantities — edit anything, add or remove items, then check
                the preview below and use <kbd className="px-1 py-0.5 bg-white border border-neutral-300 rounded text-[11px]">Ctrl+P</kbd> / <kbd className="px-1 py-0.5 bg-white border border-neutral-300 rounded text-[11px]">Cmd+P</kbd> → "Save as PDF". No markup drawings are ever included.
              </div>
              <div className="flex items-center gap-2 flex-none">
                <button
                  onClick={() => { try { window.print(); } catch (e) { /* Ctrl+P still works */ } }}
                  className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                >
                  Print / Save as PDF
                </button>
                <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-900 text-white text-xs font-semibold">
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <Field label="Revision (title reads QUOTATION (…))">
                  <input value={tq.rev} onChange={(e) => set("rev", e.target.value)} className={inputCls} />
                </Field>
                <Field label={`Date (blank = project date ${quote.projectDate || ""})`}>
                  <input value={tq.date} onChange={(e) => set("date", e.target.value)} className={inputCls} placeholder={quote.projectDate} />
                </Field>
                <Field label="Attention (contact name)">
                  <input value={tq.attentionName} onChange={(e) => set("attentionName", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Attention (company)">
                  <input value={tq.attentionCompany} onChange={(e) => set("attentionCompany", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Project title (e.g. New residence)">
                  <input value={tq.projectTitle} onChange={(e) => set("projectTitle", e.target.value)} className={inputCls} />
                </Field>
                <Field label={`Project address (one line per line; blank = ${quote.projectName || "project name"})`}>
                  <textarea value={tq.projectAddress} onChange={(e) => set("projectAddress", e.target.value)} rows={2} className={textareaCls} />
                </Field>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Project Details — line items (title · price · up to 4 dot points)</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLineItems(seedTenderItems(quote, items, rates))}
                      className="text-[11px] font-semibold text-amber-800 border border-amber-400 rounded px-2 py-0.5 hover:bg-amber-50"
                      title="Replace the line items with a fresh seed from this quote's elements — prices from the current sell allocation, dot points from the current estimating quantities. Overwrites any edits to the line items (other sections untouched)."
                    >
                      ↺ Reseed from quote &amp; estimates
                    </button>
                    <button
                      onClick={() => setLineItems([...lineItems, { id: uid(), elementId: null, title: "New item", price: "", points: ["", "", "", ""] }])}
                      className="text-[11px] font-semibold text-neutral-700 border border-neutral-300 rounded px-2 py-0.5 hover:bg-neutral-50"
                    >
                      + Add line item
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {lineItems.map((l, idx) => (
                    <div key={l.id} className="border border-neutral-200 rounded-lg p-2">
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-neutral-400 font-mono w-5 text-right">{idx + 1}.</span>
                        <input value={l.title} onChange={(e) => patchLine(l.id, { title: e.target.value })} className={`${inputCls} font-semibold`} placeholder="Item title (e.g. Ground floor)" />
                        <input value={l.price} onChange={(e) => patchLine(l.id, { price: e.target.value })} className={`${inputCls} w-52 flex-none text-right font-mono`} placeholder="$0.00 + GST" />
                        <button onClick={() => setLineItems(lineItems.filter((x) => x.id !== l.id))} className="text-neutral-300 hover:text-red-500 text-sm flex-none">✕</button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 mt-1.5 pl-7">
                        {(l.points || ["", "", "", ""]).slice(0, 4).map((p, i) => (
                          <input key={i} value={p} onChange={(e) => patchPoint(l.id, i, e.target.value)} className={`${inputCls} text-[12px]`} placeholder={`• dot point ${i + 1}`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <ProjectSumEditor tq={tq} set={set} />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Additional Options</span>
                  <button
                    onClick={() => setOpts([...opts, { id: uid(), text: "", price: "" }])}
                    className="text-[11px] font-semibold text-neutral-700 border border-neutral-300 rounded px-2 py-0.5 hover:bg-neutral-50"
                  >
                    + Add option
                  </button>
                </div>
                <div className="space-y-1.5">
                  {opts.map((o) => (
                    <div key={o.id} className="flex gap-2 items-center">
                      <input value={o.text} onChange={(e) => setOpts(opts.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))} className={inputCls} placeholder="Option description" />
                      <input value={o.price} onChange={(e) => setOpts(opts.map((x) => (x.id === o.id ? { ...x, price: e.target.value } : x)))} className={`${inputCls} w-52 flex-none text-right font-mono`} placeholder="$0.00 + GST" />
                      <button onClick={() => setOpts(opts.filter((x) => x.id !== o.id))} className="text-neutral-300 hover:text-red-500 text-sm flex-none">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Drawings — Architectural">
                  <textarea value={tq.drawingsArchitect} onChange={(e) => set("drawingsArchitect", e.target.value)} rows={3} className={textareaCls} />
                </Field>
                <Field label="Drawings — Structural">
                  <textarea value={tq.drawingsStructural} onChange={(e) => set("drawingsStructural", e.target.value)} rows={3} className={textareaCls} />
                </Field>
                <Field label="Drawings — Civil">
                  <textarea value={tq.drawingsCivil} onChange={(e) => set("drawingsCivil", e.target.value)} rows={3} className={textareaCls} />
                </Field>
              </div>

              <Field label="Tender Notes (one per line — information missing from documentation, discrepancies, assumptions etc.)">
                <textarea value={tq.tenderNotes} onChange={(e) => set("tenderNotes", e.target.value)} rows={4} className={textareaCls} />
              </Field>
              <Field label="Inclusions (one per line)">
                <textarea value={tq.inclusions} onChange={(e) => set("inclusions", e.target.value)} rows={6} className={textareaCls} />
              </Field>
              <Field label="Specific Exclusions (one per line)">
                <textarea value={tq.specificExclusions} onChange={(e) => set("specificExclusions", e.target.value)} rows={4} className={textareaCls} />
              </Field>
              <Field label="General exclusions (one per line)">
                <textarea value={tq.generalExclusions} onChange={(e) => set("generalExclusions", e.target.value)} rows={8} className={textareaCls} />
              </Field>
              <Field label="Specific Contractual Conditions / Safety / Site conditions / Quote Conditions / OHS (free text, printed as-is)">
                <textarea value={tq.contractualConditions} onChange={(e) => set("contractualConditions", e.target.value)} rows={18} className={`${textareaCls} font-mono text-[11px] whitespace-pre`} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Signed by">
                  <input value={tq.signatureName} onChange={(e) => set("signatureName", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Title">
                  <input value={tq.signatureTitle} onChange={(e) => set("signatureTitle", e.target.value)} className={inputCls} />
                </Field>
              </div>

              <div className="border-t border-neutral-200 pt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Print preview</div>
                <div className="border border-neutral-300 rounded-lg p-5 text-[11px] text-black bg-white">
                  <ReportContent quote={quote} tq={tq} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls = "w-full border border-neutral-300 rounded px-2 py-1.5 text-sm";
const textareaCls = "w-full border border-neutral-300 rounded px-2 py-1.5 text-sm";

/** The Project Sum controls: show/hide the block, override the sum, bolt an
 * extra markup on top, and choose whether GST + incl-GST lines print. The
 * numbers preview live here exactly as they'll print. */
function ProjectSumEditor({ tq, set }) {
  const gstRate = getGstRate();
  const ps = computeTenderProjectSum(tq, gstRate);
  return (
    <div className="border border-neutral-200 rounded-lg p-3 bg-neutral-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Project Sum</span>
        <label className="flex items-center gap-1.5 text-xs text-neutral-700">
          <input type="checkbox" checked={tq.showProjectSum !== false} onChange={(e) => set("showProjectSum", e.target.checked)} />
          Show on the document
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label={`Project sum override ($ ex GST — blank = sum of the line items, ${fmtMoney(ps.itemsSum)})`}>
          <input
            value={tq.projectSumOverride ?? ""}
            onChange={(e) => set("projectSumOverride", e.target.value)}
            className={`${inputCls} text-right font-mono`}
            placeholder={fmtMoney(ps.itemsSum)}
          />
        </Field>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-1.5 text-xs text-neutral-700 pb-2 flex-none">
            <input type="checkbox" checked={!!tq.markupOn} onChange={(e) => set("markupOn", e.target.checked)} />
            Include markup
          </label>
          <Field label="Markup label">
            <input value={tq.markupLabel ?? "Markup"} onChange={(e) => set("markupLabel", e.target.value)} className={inputCls} disabled={!tq.markupOn} />
          </Field>
          <Field label="Markup %">
            <input
              type="number" step="0.5"
              value={tq.markupPct ?? ""}
              onChange={(e) => set("markupPct", e.target.value)}
              className={`${inputCls} w-24 text-right font-mono`}
              placeholder="e.g. 10"
              disabled={!tq.markupOn}
            />
          </Field>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <label className="flex items-center gap-1.5 text-xs text-neutral-700">
          <input type="checkbox" checked={tq.gstOn !== false} onChange={(e) => set("gstOn", e.target.checked)} />
          Add GST — print GST ({(gstRate * 100).toLocaleString("en-AU", { maximumFractionDigits: 2 })}%) and TOTAL incl. GST lines
        </label>
        <div className="text-[12px] font-mono tabular-nums text-neutral-700">
          {ps.markupOn && <>sub {fmtMoney(ps.base)} + {ps.markupPct}% markup {fmtMoney(ps.markupAmt)} → </>}
          <b>PROJECT SUM {fmtMoney(ps.exGst)} ex GST</b>
          {ps.gstOn && <> · GST {fmtMoney(ps.gst)} · <b>incl. GST {fmtMoney(ps.incGst)}</b></>}
        </div>
      </div>
      <p className="text-[11px] text-neutral-500 mt-1.5">
        The sum adds up the line-item prices above (each read as its ex-GST figure) — type an override to replace it
        with a negotiated round figure. Markup here is an <b>extra</b> document-level markup: the seeded prices already
        carry BOMA's margin from the sell allocation, so leave it off unless you mean to add more on top.
      </p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-neutral-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Bullets({ text }) {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className="list-disc pl-6 space-y-0.5">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function ReportContent({ quote, tq }) {
  const lineItems = tq.items || [];
  const addr = (tq.projectAddress || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const gstRate = getGstRate();
  const ps = computeTenderProjectSum(tq, gstRate);
  const gstPctLabel = (gstRate * 100).toLocaleString("en-AU", { maximumFractionDigits: 2 });
  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 text-center pt-2">
          <span className="text-2xl font-bold underline underline-offset-4">QUOTATION{tq.rev ? ` (${tq.rev})` : ""}</span>
        </div>
        <img src={BOMA_LOGO_FULL_DATA_URI} alt="BOMA ESTIMATES" className="h-44 flex-none" />
      </div>

      <table className="mb-3">
        <tbody className="align-top">
          <tr><td className="font-bold pr-10 py-0.5 align-top">Date:</td><td>{tq.date || quote.projectDate}</td></tr>
          <tr><td className="font-bold pr-10 py-0.5 align-top">Attention:</td><td>{tq.attentionName}{tq.attentionCompany ? <><br />{tq.attentionCompany}</> : null}</td></tr>
          <tr>
            <td className="font-bold pr-10 py-0.5 align-top">Project:</td>
            <td>
              {tq.projectTitle && <>{tq.projectTitle}<br /></>}
              {addr.length ? addr.map((l, i) => <span key={i}>{l}<br /></span>) : (quote.projectName || "Untitled project")}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mb-3">
        <div className="font-bold mb-1">Project Details:</div>
        {lineItems.length === 0 && <div className="text-neutral-500 italic">No line items yet.</div>}
        <ol className="space-y-2">
          {lineItems.map((l, i) => (
            <li key={l.id} className="break-inside-avoid">
              <div className="flex justify-between">
                <span className="font-bold">{i + 1}. {l.title}{l.title && !/[:：]\s*$/.test(l.title) ? ":" : ""}</span>
                <span className="font-bold">{l.price}</span>
              </div>
              <Bullets text={(l.points || []).join("\n")} />
            </li>
          ))}
        </ol>
        {tq.showProjectSum !== false && (
          <div className="mt-3 ml-auto w-80 break-inside-avoid">
            {ps.markupOn && (
              <>
                <div className="flex justify-between py-0.5">
                  <span>Sub Total (ex GST)</span>
                  <span className="font-mono tabular-nums">{fmtMoney(ps.base)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>{tq.markupLabel || "Markup"} ({ps.markupPct}%)</span>
                  <span className="font-mono tabular-nums">{fmtMoney(ps.markupAmt)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between py-0.5 font-bold border-t-2 border-black">
              <span>PROJECT SUM {ps.gstOn ? "(ex GST)" : ""}</span>
              <span className="font-mono tabular-nums">{fmtMoney(ps.exGst)}{ps.gstOn ? "" : " + GST"}</span>
            </div>
            {ps.gstOn && (
              <>
                <div className="flex justify-between py-0.5">
                  <span>GST ({gstPctLabel}%)</span>
                  <span className="font-mono tabular-nums">{fmtMoney(ps.gst)}</span>
                </div>
                <div className="flex justify-between py-0.5 font-bold border-t border-black">
                  <span>TOTAL (incl. GST)</span>
                  <span className="font-mono tabular-nums">{fmtMoney(ps.incGst)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {(tq.additionalOptions || []).some((o) => (o.text || "").trim()) && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Additional Options:</div>
          <ul className="list-disc pl-6 space-y-0.5">
            {(tq.additionalOptions || []).filter((o) => (o.text || "").trim()).map((o) => (
              <li key={o.id}>
                <div className="flex justify-between"><span>{o.text}</span><span className="pl-4 flex-none">{o.price}</span></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(tq.drawingsArchitect || tq.drawingsStructural || tq.drawingsCivil) && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Drawings relevant to quote:</div>
          {[["Architectural", tq.drawingsArchitect], ["Structural", tq.drawingsStructural], ["Civil", tq.drawingsCivil]].map(([label, text]) =>
            text ? (
              <div key={label} className="flex gap-2 mb-1 pl-6"><span className="w-28 flex-none">• {label}:</span><span className="whitespace-pre-wrap">{text}</span></div>
            ) : null
          )}
        </div>
      )}

      {tq.tenderNotes && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Tender Notes: <span className="font-normal italic">(information missing from documentation, discrepancies, assumptions etc.)</span></div>
          <Bullets text={tq.tenderNotes} />
        </div>
      )}

      {tq.inclusions && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Inclusions:</div>
          <Bullets text={tq.inclusions} />
        </div>
      )}

      {tq.specificExclusions && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Specific Exclusions:</div>
          <Bullets text={tq.specificExclusions} />
        </div>
      )}

      {tq.generalExclusions && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">General exclusions <span className="font-normal italic">(Unless noted in inclusions):</span></div>
          <Bullets text={tq.generalExclusions} />
        </div>
      )}

      {tq.contractualConditions && (
        <div className="mb-3">
          <div className="font-bold mb-1">Specific Contractual Conditions:</div>
          <div className="whitespace-pre-wrap">{tq.contractualConditions}</div>
        </div>
      )}

      <div className="mt-8 break-inside-avoid border-t border-black pt-2 w-64">
        <div>{tq.signatureName}</div>
        <div>{tq.signatureTitle}</div>
        <div>BOMA ESTIMATES</div>
      </div>
    </>
  );
}
