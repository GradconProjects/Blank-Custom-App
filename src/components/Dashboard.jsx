import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ArrowRight, LayoutDashboard, Loader2, FolderOpen } from "lucide-react";
import { QUOTE_STATUSES, QUOTE_STATUS_STYLES } from "../data/catalog.js";
import { computeGrandTotal, computeMarginLadder, money, getDefaultMargin, getMarginSteps } from "../lib/costing.js";
import { readQuotes, readQuotesCached, writeQuote } from "../lib/projects.js";
import { dashboardDueLabel } from "../lib/planner.js";

const SORT_OPTIONS = [
  { key: "added", label: "Recently added" },
  { key: "status", label: "Status (pipeline order)" },
  { key: "name", label: "Project name" },
  { key: "deadline", label: "Deadline (soonest first)" },
  { key: "value", label: "Value (highest sell first)" },
  { key: "date", label: "Project date (newest first)" },
];

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
    getMarginSteps()
  );
  const defaultRow = rows.find((r) => Math.abs(r.margin - getDefaultMargin()) < 1e-9) || rows[0];
  return {
    name: quote.projectName || "Untitled project",
    client: quote.clientName || "",
    date: quote.projectDate,
    // Only a status the style table knows: the rows below index
    // QUOTE_STATUS_STYLES by this value, and one stale/renamed status in any
    // single quote would otherwise take the whole dashboard down.
    status: QUOTE_STATUSES.includes(quote.status) ? quote.status : QUOTE_STATUSES[0],
    deadline: quote.planner?.deadline || null,
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

export default function Dashboard({ projects, rates, onOpen, onCreate, onDelete, onImportFile, onPrune }) {
  // First paint comes from the last-known summary mirror (instant), then the
  // effect below replaces it with what the database actually holds. An
  // install without a mirror yet starts empty exactly as before.
  const [quotesByKey, setQuotesByKey] = useState(() => readQuotesCached(projects.map((p) => p.storageKey)));
  const [loading, setLoading] = useState(true);
  // Two-click "arm, then confirm" delete instead of window.confirm() — a
  // native confirm() dialog can be silently blocked (throws or is a no-op)
  // when this app is embedded in a sandboxed iframe, e.g. hosted inside
  // the portal shell inside an Artifact viewer, which made Delete appear
  // to do nothing. This has no dependency on any browser dialog API.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const armDelete = (id) => {
    // Portal Settings "ask before deleting" toggle — explicitly off skips
    // the arm step and deletes on the first click.
    try {
      const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
      if (p.confirmDeletes === false) { onDelete(id); return; }
    } catch { /* fall through to the confirm flow */ }
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
      // An index entry whose data row does not exist is an "Untitled
      // project" that can never be opened or edited — a project whose first
      // save never landed, or a delete that only half-completed. Drop it.
      // Only when the fetch plainly succeeded (it returned at least one
      // quote): an empty map is also what a failed fetch looks like, and
      // that must never prune anything. A brand-new entry is left alone
      // for an hour so a slow first save cannot be mistaken for an orphan.
      if (onPrune && Object.keys(map).length > 0) {
        const cutoff = Date.now() - 60 * 60 * 1000;
        const orphans = projects
          .filter((p) => !map[p.storageKey] && Date.parse(p.createdAt || 0) < cutoff)
          .map((p) => p.id);
        if (orphans.length) onPrune(orphans);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const summaries = useMemo(
    () => projects.map((p) => ({ project: p, ...summarizeQuote(quotesByKey[p.storageKey], rates) })),
    [projects, quotesByKey, rates]
  );

  const [sortBy, setSortBy] = useState(() => {
    // Initial sort from the portal Settings preference; session-local after that.
    try {
      const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
      return SORT_OPTIONS.some((o) => o.key === p.quotesDefaultSort) ? p.quotesDefaultSort : "added";
    } catch {
      return "added";
    }
  });
  const sortedSummaries = useMemo(() => {
    const arr = [...summaries];
    if (sortBy === "status") {
      arr.sort((a, b) => QUOTE_STATUSES.indexOf(a.status) - QUOTE_STATUSES.indexOf(b.status) || a.name.localeCompare(b.name));
    } else if (sortBy === "name") {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "deadline") {
      // Soonest deadline first; projects without one sink to the bottom.
      const t = (s) => (s.deadline ? Number(new Date(s.deadline)) : Infinity);
      arr.sort((a, b) => t(a) - t(b) || a.name.localeCompare(b.name));
    } else if (sortBy === "value") {
      arr.sort((a, b) => b.sellExGst - a.sellExGst || a.name.localeCompare(b.name));
    } else if (sortBy === "date") {
      arr.sort((a, b) => Number(new Date(b.date || 0)) - Number(new Date(a.date || 0)) || a.name.localeCompare(b.name));
    } else {
      // Recently added — newest first, by the project index's own immutable createdAt
      // (not quote.projectDate, which the estimator can freely edit).
      arr.sort((a, b) => Number(new Date(b.project.createdAt || 0)) - Number(new Date(a.project.createdAt || 0)));
    }
    return arr;
  }, [summaries, sortBy]);

  // Filter row: status dropdown + free-text name search, applied on top of
  // the chosen sort. Session-local — a fresh load shows everything.
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const visibleSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedSummaries.filter(
      (s) => (!statusFilter || s.status === statusFilter) && (!q || s.name.toLowerCase().includes(q) || s.client.toLowerCase().includes(q))
    );
  }, [sortedSummaries, statusFilter, search]);
  const filtering = !!statusFilter || !!search.trim();
  // One count per status, off the SEARCHED set rather than the fully filtered
  // one — so the buttons show how many projects each status would give you
  // right now, and a status with none reads as 0 instead of vanishing.
  const statusCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = sortedSummaries.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.client.toLowerCase().includes(q)
    );
    const counts = { "": searched.length };
    QUOTE_STATUSES.forEach((st) => { counts[st] = 0; });
    searched.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; });
    return counts;
  }, [sortedSummaries, search]);

  const changeStatus = (project, status) => {
    const quote = quotesByKey[project.storageKey] || {};
    const updated = { ...quote, status };
    setQuotesByKey((m) => ({ ...m, [project.storageKey]: updated }));
    writeQuote(project.storageKey, updated);
  };

  // The project's client/owner is edited HERE, beside the project name —
  // the dashboard is where projects get scanned by who they belong to, so
  // it isn't duplicated in the project editor's own header. Same
  // optimistic-local-then-write path as the status dropdown above.
  const changeClient = (project, clientName) => {
    const quote = quotesByKey[project.storageKey] || {};
    const updated = { ...quote, clientName };
    setQuotesByKey((m) => ({ ...m, [project.storageKey]: updated }));
    writeQuote(project.storageKey, updated);
  };

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
          <p className="text-sm text-neutral-500">Every BOMA quote, summed across the whole portfolio.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects / clients…"
            className="border border-neutral-200 rounded px-2.5 py-1.5 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border border-neutral-200 rounded px-2 py-1 text-xs"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          {onImportFile && (
            <label
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-sm font-medium transition-colors cursor-pointer"
              title="Open a quote saved with “Save to computer” or downloaded from a project's Versions"
            >
              <FolderOpen size={16} /> Open .json
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = "";
                  if (!file) return;
                  file.text().then((text) => onImportFile(text, file.name));
                }}
              />
            </label>
          )}
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-950 hover:bg-blue-900 text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} /> New project
          </button>
        </div>
      </div>

      {/* Status filter tiles — one per status plus All projects. Each tile is
          FILLED with its status's own solid colour (the same `bar` shade the
          row dots use), not a white chip with coloured text, so the row reads
          as the pipeline at a glance. The count is the tile's headline.
          Clicking one filters the table below to just those projects;
          clicking the active one again clears back to all. The active tile is
          marked by a dark ring and shadow rather than by a colour change —
          colour is spoken for by the status itself. */}
      <div className="flex flex-wrap gap-2">
        {[["", "All projects"], ...QUOTE_STATUSES.map((s2) => [s2, s2])].map(([value, label]) => {
          const active = statusFilter === value;
          // "All projects" has no catalog status colour — give it the app's
          // own navy so the row reads as one set rather than one odd tile.
          const style = QUOTE_STATUS_STYLES[value] || {
            bar: "bg-blue-950", dot: "bg-blue-950", text: "text-blue-900", bg: "bg-blue-50",
          };
          // Every status bar is dark enough to carry white text except On
          // Hold's deliberately washed-out neutral — that one needs dark ink.
          const light = style.bar === "bg-neutral-300";
          const ink = light ? "text-neutral-800" : "text-white";
          const count = statusCounts[value] || 0;
          return (
            <button
              key={value || "__all"}
              onClick={() => setStatusFilter(active ? "" : value)}
              aria-pressed={active}
              title={`${label} — ${count} project${count === 1 ? "" : "s"}`}
              className={`relative overflow-hidden flex-1 min-w-[112px] max-w-[168px] min-h-[92px] rounded-xl border border-transparent flex flex-col items-center justify-center gap-1.5 px-3 py-3 transition-all ${style.bar} ${ink} ${
                active
                  ? "shadow-lg ring-2 ring-offset-2 ring-blue-950 scale-[1.03]"
                  : `shadow-sm hover:brightness-110 hover:shadow-md ${count === 0 ? "opacity-50" : ""}`
              }`}
            >
              {/* a soft wash behind the count, so the headline number reads as
                  a badge rather than floating on the flat fill */}
              <span
                className={`inline-flex items-center justify-center min-w-[2.25rem] px-2 py-0.5 rounded-lg font-mono tabular-nums text-2xl font-bold leading-none ${
                  light ? "bg-white/70" : "bg-black/20"
                }`}
              >
                {count}
              </span>
              <span className="text-[11px] font-semibold leading-tight text-center">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Projects" value={summaries.length} />
        <StatTile label="Total direct cost" value={money(totals.directCost)} />
        <StatTile
          label={`Total sell (${Math.round(getDefaultMargin() * 100)}% margin, ex GST)`}
          value={money(totals.sellExGst)}
          highlight
        />
        <StatTile label="Total GFA" value={`${totals.gfa.toLocaleString("en-AU")} m²`} />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2" />
              <th className="text-left px-4 py-2 font-medium">Project</th>
              <th className="text-left px-3 py-2 font-medium">Client</th>
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-3 py-2 font-medium">Deadline</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Elements</th>
              <th className="text-right px-3 py-2 font-medium">Direct cost</th>
              <th className="text-right px-3 py-2 font-medium">Sell ({Math.round(getDefaultMargin() * 100)}%, ex GST)</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visibleSummaries.map(({ project, ...s }) => (
              <tr
                key={project.id}
                className="border-t border-neutral-100 hover:bg-neutral-50 cursor-pointer"
                onClick={() => onOpen(project.id)}
              >
                <td className="pl-4 pr-1 py-3">
                  <span
                    className={`inline-block w-3.5 h-3.5 rounded-full flex-none ${QUOTE_STATUS_STYLES[s.status].dot}`}
                    title={s.status}
                  />
                </td>
                <td className="px-4 py-3 font-semibold text-[15px] text-neutral-900">{s.name}</td>
                <td className="px-3 py-2.5">
                  <input
                    value={s.client}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => changeClient(project, e.target.value)}
                    placeholder="+ client"
                    title="Client / owner — click to edit"
                    className="w-full bg-transparent border-0 text-sm text-neutral-600 focus:outline-none focus:underline decoration-orange-400 placeholder:text-neutral-300"
                  />
                </td>
                <td className="px-3 py-2.5 text-neutral-400 text-xs">{s.date || "—"}</td>
                <td className="px-3 py-2.5 text-xs">
                  {(() => {
                    const due = dashboardDueLabel(s.deadline);
                    return due ? <span className={due.cls}>{due.text}</span> : <span className="text-neutral-300">—</span>;
                  })()}
                </td>
                <td className="px-3 py-2.5">
                  <select
                    value={s.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => changeStatus(project, e.target.value)}
                    className={`bg-transparent border-0 rounded px-1 py-1 text-xs font-medium ${QUOTE_STATUS_STYLES[s.status].text}`}
                  >
                    {QUOTE_STATUSES.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-400 text-xs">{s.elementCount}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-500">{money(s.directCost)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-orange-600 font-semibold">
                  {money(s.sellExGst)}
                </td>
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
                <td colSpan={10} className="text-center py-12 text-neutral-400">
                  <Loader2 size={16} className="inline animate-spin mr-1.5" /> Loading projects…
                </td>
              </tr>
            )}
            {summaries.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center py-12 text-neutral-400">
                  No projects yet — click &quot;New project&quot; to start your first quote.
                </td>
              </tr>
            )}
            {summaries.length > 0 && visibleSummaries.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-12 text-neutral-400">
                  No projects match the current search/filter.
                </td>
              </tr>
            )}
          </tbody>
          {summaries.length > 0 && (() => {
            // Footer follows the filter: sums what's actually listed, and says so.
            const ft = filtering
              ? visibleSummaries.reduce(
                  (acc, s) => ({
                    directCost: acc.directCost + s.directCost,
                    sellExGst: acc.sellExGst + s.sellExGst,
                    gfa: acc.gfa + s.gfa,
                    elementCount: acc.elementCount + s.elementCount,
                  }),
                  { directCost: 0, sellExGst: 0, gfa: 0, elementCount: 0 }
                )
              : totals;
            return (
            <tfoot>
              <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                <td className="px-4 py-2.5" colSpan={6}>
                  {filtering ? `Filtered projects (${visibleSummaries.length} of ${summaries.length})` : "All projects"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{ft.elementCount}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{money(ft.directCost)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-orange-600">{money(ft.sellExGst)}</td>
                <td />
              </tr>
            </tfoot>
            );
          })()}
        </table>
      </div>
    </div>
  );
}
