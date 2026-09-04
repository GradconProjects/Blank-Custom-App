import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ArrowRight, LayoutDashboard, Loader2 } from "lucide-react";
import { MARGIN_STEPS, DEFAULT_MARGIN } from "../data/catalog.js";
import { computeGrandTotal, computeMarginLadder, money, money2 } from "../lib/costing.js";
import { readQuotes } from "../lib/projects.js";

/** Turns one pre-fetched quote object into the numbers a dashboard row (or
 * the portfolio totals) needs. Mirrors the same costing calls
 * QuoteSummary.jsx uses so the figures always agree with what you'd see
 * inside the project itself. */
function summarizeQuote(quote, rates) {
  quote = quote || {};
  const items = quote.items || [];
  const directCost = computeGrandTotal(items, rates);
  const { subtotal, rows } = computeMarginLadder(
    directCost,
    quote.overheadPct ?? 0.08,
    quote.contingencyPct ?? 0.05,
    quote.gfa,
    MARGIN_STEPS
  );
  const defaultRow = rows.find((r) => Math.abs(r.margin - DEFAULT_MARGIN) < 1e-9) || rows[0];
  return {
    name: quote.projectName || "Untitled project",
    date: quote.projectDate,
    gfa: Number(quote.gfa) || 0,
    elementCount: items.length,
    directCost,
    subtotal,
    sellExGst: defaultRow?.sellExGst || 0,
    perM2: defaultRow?.perM2 || 0,
  };
}

function StatTile({ label, value, highlight }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? "border-orange-200 bg-orange-50" : "border-neutral-200 bg-white"}`}>
      <div className="text-[10px] uppercase tracking-widest text-neutral-400 font-semibold">{label}</div>
      <div className={`font-mono tabular-nums text-lg font-bold ${highlight ? "text-orange-600" : "text-neutral-800"}`}>{value}</div>
    </div>
  );
}

export default function Dashboard({ projects, rates, onOpen, onCreate, onDelete }) {
  const [quotesByKey, setQuotesByKey] = useState({});
  const [loading, setLoading] = useState(true);
  // Two-click "arm, then confirm" delete instead of window.confirm() — a
  // native confirm() dialog can be silently blocked (throws or is a no-op)
  // when this app is embedded in a sandboxed iframe, e.g. hosted inside
  // the portal shell inside an Artifact viewer, which made Delete appear
  // to do nothing. This has no dependency on any browser dialog API.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const armDelete = (id) => {
    setConfirmDeleteId(id);
    setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readQuotes(projects.map((p) => p.storageKey)).then((map) => {
      if (cancelled) return;
      setQuotesByKey(map);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const summaries = useMemo(
    () => projects.map((p) => ({ project: p, ...summarizeQuote(quotesByKey[p.storageKey], rates) })),
    [projects, quotesByKey, rates]
  );

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({
          directCost: acc.directCost + s.directCost,
          sellExGst: acc.sellExGst + s.sellExGst,
          gfa: acc.gfa + s.gfa,
          elementCount: acc.elementCount + s.elementCount,
        }),
        { directCost: 0, sellExGst: 0, gfa: 0, elementCount: 0 }
      ),
    [summaries]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
            <LayoutDashboard size={20} className="text-orange-500" /> Projects Dashboard
          </h1>
          <p className="text-sm text-neutral-500">Every quote, summed across the whole portfolio.</p>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-950 hover:bg-blue-900 text-white text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New project
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Projects" value={summaries.length} />
        <StatTile label="Total direct cost" value={money(totals.directCost)} />
        <StatTile
          label={`Total sell (${Math.round(DEFAULT_MARGIN * 100)}% margin, ex GST)`}
          value={money(totals.sellExGst)}
          highlight
        />
        <StatTile label="Total GFA" value={`${totals.gfa.toLocaleString("en-AU")} m²`} />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Project</th>
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-right px-3 py-2 font-medium">Elements</th>
              <th className="text-right px-3 py-2 font-medium">GFA</th>
              <th className="text-right px-3 py-2 font-medium">Direct cost</th>
              <th className="text-right px-3 py-2 font-medium">Sell ({Math.round(DEFAULT_MARGIN * 100)}%, ex GST)</th>
              <th className="text-right px-3 py-2 font-medium">$/m²</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {summaries.map(({ project, ...s }) => (
              <tr
                key={project.id}
                className="border-t border-neutral-100 hover:bg-neutral-50 cursor-pointer"
                onClick={() => onOpen(project.id)}
              >
                <td className="px-4 py-2.5 font-medium text-neutral-800">{s.name}</td>
                <td className="px-3 py-2.5 text-neutral-500">{s.date || "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{s.elementCount}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{s.gfa ? `${s.gfa} m²` : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{money(s.directCost)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-orange-600 font-semibold">
                  {money(s.sellExGst)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{s.perM2 > 0 ? money2(s.perM2) : "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(project.id);
                      }}
                      className="p-1.5 rounded hover:bg-neutral-200 text-neutral-500"
                      title="Open"
                    >
                      <ArrowRight size={14} />
                    </button>
                    {confirmDeleteId === project.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                          onDelete(project.id);
                        }}
                        className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold whitespace-nowrap"
                        title="Click again to permanently delete"
                      >
                        Confirm delete?
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          armDelete(project.id);
                        }}
                        className="p-1.5 rounded hover:bg-red-100 text-neutral-400 hover:text-red-600"
                        title="Delete project"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {summaries.length === 0 && loading && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-neutral-400">
                  <Loader2 size={16} className="inline animate-spin mr-1.5" /> Loading projects…
                </td>
              </tr>
            )}
            {summaries.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-neutral-400">
                  No projects yet — click &quot;New project&quot; to start your first quote.
                </td>
              </tr>
            )}
          </tbody>
          {summaries.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>All projects</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{totals.elementCount}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{totals.gfa.toLocaleString("en-AU")} m²</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{money(totals.directCost)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-orange-600">{money(totals.sellExGst)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
