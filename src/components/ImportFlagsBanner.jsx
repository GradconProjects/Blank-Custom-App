import { AlertTriangle, X } from "lucide-react";

/**
 * Shown once on a project created by "Publish to Quote" from the Estimates
 * tool (see lib/estimateImport.js). Lists everything that couldn't be
 * confidently prefilled so the estimator checks it before pricing —
 * exactly the "prefill what works, flag what doesn't" contract that
 * import is built on. Dismissing just clears quote.importFlags; nothing
 * else about the quote changes.
 */
export default function ImportFlagsBanner({ flags, onDismiss }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="print:hidden mb-3 rounded-xl border border-amber-300 bg-amber-50 overflow-hidden">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <AlertTriangle size={18} className="flex-none mt-0.5 text-amber-600" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-amber-900 text-sm mb-1">
            Imported from Estimates — {flags.length} item{flags.length === 1 ? "" : "s"} need a look
          </div>
          <ul className="space-y-1 text-xs text-amber-800 list-disc list-inside">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
        <button
          onClick={onDismiss}
          className="flex-none p-1 rounded hover:bg-amber-200/60 text-amber-700"
          title="Dismiss — I've reviewed these"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
