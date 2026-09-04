import { useRef } from "react";
import { computeExternalScopeLines, money2, getDefaultMargin } from "../lib/costing.js";
import { BOMA_LOGO_DATA_URI } from "../lib/logo.js";
import { newExternalQuote } from "../lib/externalQuoteDefaults.js";

/**
 * The client-facing quotation letter — deliberately separate from
 * PrintQuoteReport.jsx (renamed "Internal Quote" in the UI), which shows
 * the estimator's own cost/material/labour breakdown a client should never see.
 * This instead matches the shape of a real quotation letter: scope
 * items priced in lump sums, inclusions/exclusions, standard contractual
 * conditions, and a signature block.
 *
 * Two things are deliberately NOT freely editable text, because they're the
 * one part of this document that must never silently drift from the real
 * numbers in the books: the scope $ lines and the TOTAL are always
 * recomputed live from the quote's own elements via
 * computeExternalScopeLines (see lib/costing.js) — one line per element,
 * priced as that element's share of the actual sell price. Everything else
 * (attention, drawings, tender notes, inclusions, exclusions, contractual
 * conditions, signature) is plain free text the estimator edits per job,
 * seeded once from the standard letter wording (see
 * lib/externalQuoteDefaults.js) the first time this is opened for a
 * project.
 *
 * Same dual-render pattern as PrintQuoteReport: a `hidden print:block` copy
 * (only rendered when this is the active print target — see App.jsx's
 * printTarget) plus an on-screen editable modal, since window.print() can
 * be silently blocked in a sandboxed iframe with no reliable way to detect
 * that failure.
 */
export default function ExternalQuoteReport({ quote, items, rates, visible, onClose, onChange, isPrintTarget }) {
  const eq = quote.externalQuote || newExternalQuote();
  const set = (field, value) => onChange({ ...eq, [field]: value });

  const fileInputRef = useRef(null);
  const onSignatureFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("signatureImage", reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <>
      {isPrintTarget && (
        <div className="hidden print:block text-black text-[11px]">
          <ReportContent quote={quote} items={items} rates={rates} eq={eq} />
        </div>
      )}
      {visible && (
        <div className="print:hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-neutral-200 bg-amber-50 rounded-t-xl">
              <div className="text-[13px] text-neutral-800">
                <b>External Quote — editable client letter.</b> Everything below except the scope $ amounts and TOTAL
                (always live from this quote's own elements) is plain text you can edit freely. When you're happy with
                it, use your browser's own Print command — <kbd className="px-1 py-0.5 bg-white border border-neutral-300 rounded text-[11px]">Ctrl+P</kbd> (Windows)
                or <kbd className="px-1 py-0.5 bg-white border border-neutral-300 rounded text-[11px]">Cmd+P</kbd> (Mac) — then choose "Save as PDF".
              </div>
              <div className="flex items-center gap-2 flex-none">
                <button
                  onClick={() => { try { window.print(); } catch (e) { /* Ctrl+P still works */ } }}
                  className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                >
                  Print / Save as PDF
                </button>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-900 text-white text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Attention (contact name)">
                  <input value={eq.attentionName} onChange={(e) => set("attentionName", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Attention (company)">
                  <input value={eq.attentionCompany} onChange={(e) => set("attentionCompany", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Scope description (e.g. Renovations)">
                  <input value={eq.scopeDescription} onChange={(e) => set("scopeDescription", e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Drawings — Architectural">
                <textarea value={eq.drawingsArchitect} onChange={(e) => set("drawingsArchitect", e.target.value)} rows={2} className={textareaCls} />
              </Field>
              <Field label="Drawings — Structural">
                <textarea value={eq.drawingsStructural} onChange={(e) => set("drawingsStructural", e.target.value)} rows={2} className={textareaCls} />
              </Field>
              <Field label="Tender Notes (one per line)">
                <textarea value={eq.tenderNotes} onChange={(e) => set("tenderNotes", e.target.value)} rows={3} className={textareaCls} />
              </Field>
              <Field label="Inclusions (one per line)">
                <textarea value={eq.inclusions} onChange={(e) => set("inclusions", e.target.value)} rows={5} className={textareaCls} />
              </Field>
              <Field label="General Exclusions (one per line)">
                <textarea value={eq.exclusions} onChange={(e) => set("exclusions", e.target.value)} rows={8} className={textareaCls} />
              </Field>
              <Field label="Specific Contractual Conditions">
                <textarea value={eq.contractualConditions} onChange={(e) => set("contractualConditions", e.target.value)} rows={16} className={`${textareaCls} font-mono text-[11px] whitespace-pre`} />
              </Field>
              <div className="grid grid-cols-2 gap-3 items-start">
                <Field label="Signed by">
                  <input value={eq.signatureName} onChange={(e) => set("signatureName", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Title">
                  <input value={eq.signatureTitle} onChange={(e) => set("signatureTitle", e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Signature image">
                <div className="flex items-center gap-3">
                  {eq.signatureImage && <img src={eq.signatureImage} alt="Signature" className="h-14 border border-neutral-200 rounded bg-white px-2" />}
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={onSignatureFile} className="text-xs" />
                  {eq.signatureImage && (
                    <button
                      onClick={() => { set("signatureImage", null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </Field>

              <div className="border-t border-neutral-200 pt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Print preview</div>
                <div className="border border-neutral-300 rounded-lg p-4 text-[11px] text-black bg-white">
                  <ReportContent quote={quote} items={items} rates={rates} eq={eq} />
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
    <ul className="list-disc pl-5 space-y-0.5">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function ReportContent({ quote, items, rates, eq }) {
  const { lines, totalExGst } = computeExternalScopeLines(items, rates, quote.overheadPct, quote.contingencyPct, getDefaultMargin());

  return (
    <>
      <div className="flex items-start justify-between border-b-2 border-black pb-2 mb-3">
        <div className="text-2xl font-bold tracking-wide">QUOTATION</div>
        <img src={BOMA_LOGO_DATA_URI} alt="BOMA ESTIMATES" className="h-10" />
      </div>

      <div className="space-y-1 mb-3">
        <div><b>Date:</b> {quote.projectDate}</div>
        <div><b>Attention:</b> {eq.attentionName}{eq.attentionCompany ? ` (${eq.attentionCompany})` : ""}</div>
        <div>
          <b>Project:</b> {eq.scopeDescription}
          <br />
          {quote.projectName || "Untitled project"}
        </div>
      </div>

      <div className="mb-3 break-inside-avoid">
        <div className="font-bold mb-1">Project Details:</div>
        {lines.length === 0 && <div className="text-neutral-500 italic">No quantities entered yet.</div>}
        {lines.map((l, i) => (
          <div key={l.id} className="flex justify-between py-0.5">
            <span>{i + 1}. {l.label}</span>
            <span>{money2(l.sellExGst)} + GST</span>
          </div>
        ))}
        <div className="flex justify-between font-bold border-t-2 border-black mt-1 pt-1">
          <span>TOTAL</span>
          <span>{money2(totalExGst)} + GST</span>
        </div>
      </div>

      {(eq.drawingsArchitect || eq.drawingsStructural) && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Drawings relevant to quote:</div>
          {eq.drawingsArchitect && (
            <div className="flex gap-2 mb-1"><span className="w-24 flex-none">Architectural:</span><span className="whitespace-pre-wrap">{eq.drawingsArchitect}</span></div>
          )}
          {eq.drawingsStructural && (
            <div className="flex gap-2"><span className="w-24 flex-none">Structural:</span><span className="whitespace-pre-wrap">{eq.drawingsStructural}</span></div>
          )}
        </div>
      )}

      {eq.tenderNotes && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Tender Notes: <span className="font-normal italic">(information missing from documentation, discrepancies, assumptions etc.)</span></div>
          <Bullets text={eq.tenderNotes} />
        </div>
      )}

      {eq.inclusions && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">Inclusions:</div>
          <Bullets text={eq.inclusions} />
        </div>
      )}

      {eq.exclusions && (
        <div className="mb-3 break-inside-avoid">
          <div className="font-bold mb-1">General exclusions <span className="font-normal">(Unless noted in inclusions):</span></div>
          <Bullets text={eq.exclusions} />
        </div>
      )}

      {eq.contractualConditions && (
        <div className="mb-3">
          <div className="font-bold mb-1">Specific Contractual Conditions:</div>
          <div className="whitespace-pre-wrap">{eq.contractualConditions}</div>
        </div>
      )}

      <div className="mt-6 break-inside-avoid">
        {eq.signatureImage && <img src={eq.signatureImage} alt="Signature" className="h-16 mb-1" />}
        <div className="border-t border-black w-56 pt-1">
          <div>{eq.signatureName}</div>
          <div>{eq.signatureTitle}</div>
          <div>BOMA ESTIMATES</div>
        </div>
      </div>
    </>
  );
}
