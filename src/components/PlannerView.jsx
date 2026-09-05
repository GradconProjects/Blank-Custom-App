import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Clock, GitBranch, HardHat, HelpCircle, Loader2, MessageSquarePlus, Package, Plus, Radar, Receipt, Trash2 } from "lucide-react";
import { PLANNER_PRIORITIES, PLANNER_PRIORITY_STYLES } from "../data/catalog.js";
import { readQuotes, writeQuote } from "../lib/projects.js";
import { uid, money2 } from "../lib/costing.js";
import { useStoredState } from "../lib/storage.js";
import { isUrgent, daysLabel, priorityRank } from "../lib/planner.js";

const CHANNELS = ["Call", "Email", "Site meeting", "Text/WhatsApp", "Other"];
const VARIATION_STATUSES = ["Draft", "Submitted", "Approved", "Rejected"];

// Seed rows for the contractor/supplier registers — placeholders only.
//
// These used to carry the real trade contacts (names, mobiles, email
// addresses) lifted from the original business's email history. That is
// other people's personal data and it has no business shipping inside an app
// that gets deployed publicly and handed to strangers, so the rows are now
// role descriptions with every contact field blank. The register still
// demonstrates its shape; the estimator fills in their own contacts, which
// then persist like any other edit.
//
// These are the registers' *initial* value only — the first time anyone edits
// (or deletes) a row, the whole edited list is what gets persisted
// (localStorage/Supabase) and these defaults never reassert themselves. IDs
// are fixed strings, not uid(), so the same seed rows carry identical
// identity on every device that first saves them.
const blankRow = (id, name, role) => ({ id, name, role, contact: "", phone: "", email: "", notes: "" });

const DEFAULT_CONTRACTORS = [
  blankRow("seed-piling", "", "Piling — bored piers, CFA, screw piles"),
  blankRow("seed-formwork", "", "Formwork — suspended slabs, hobs, edges"),
  blankRow("seed-posttension", "", "Post-tensioning"),
  blankRow("seed-basement", "", "Basement construction"),
  blankRow("seed-reofix", "", "Reinforcement fixing"),
  blankRow("seed-screed", "", "Engineered screed — supply & install"),
  blankRow("seed-steelerect", "", "Structural steel — supply & erect"),
];
const DEFAULT_SUPPLIERS = [
  blankRow("seed-reo", "", "Reinforcement steel"),
  blankRow("seed-concrete", "", "Concrete supply"),
  blankRow("seed-formply", "", "Formwork materials"),
  blankRow("seed-accessories", "", "Concreting accessories"),
  blankRow("seed-insulation", "", "Insulation & foam products"),
  blankRow("seed-plant", "", "Plant hire"),
  blankRow("seed-steel", "", "Structural steel & purlins"),
];
// Portal Settings preference for the priority a project shows before anyone
// has set one — validated against the real list so a stale/typo'd stored
// value can never render an unstyled priority.
const defaultPriority = () => {
  try {
    const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
    return PLANNER_PRIORITIES.includes(p.plannerDefaultPriority) ? p.plannerDefaultPriority : "Medium";
  } catch {
    return "Medium";
  }
};

/**
 * Project Management — the old Planner tab, grown into a sub-tabbed section:
 * Planner (deadlines/priorities/comms, unchanged), Variations (per-project
 * variation register, stored on each quote), and global Contractor/Supplier
 * registers (via useStoredState, so they sync through Supabase like every
 * other persisted blob). The App.jsx view key stays "planner" — the portal
 * shell's welcome tile and any remembered view both point at it.
 */
export default function PlannerView({ projects, onOpen }) {
  const [tab, setTab] = useState("planner");
  const [quotesByKey, setQuotesByKey] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readQuotes(projects.map((p) => p.storageKey)).then((map) => {
      if (cancelled) return;
      setQuotesByKey(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projects]);

  const patchQuote = (project, patch) => {
    const quote = quotesByKey[project.storageKey] || {};
    const updated = { ...quote, ...patch };
    setQuotesByKey((m) => ({ ...m, [project.storageKey]: updated }));
    writeQuote(project.storageKey, updated);
  };

  const TABS = [
    { key: "planner", label: "Planner", Icon: Radar },
    { key: "variations", label: "Variations", Icon: GitBranch },
    { key: "rfis", label: "RFIs", Icon: HelpCircle },
    { key: "claims", label: "Progress Claims", Icon: Receipt },
    { key: "defects", label: "Defects", Icon: AlertTriangle },
    { key: "contractors", label: "Contractors", Icon: HardHat },
    { key: "suppliers", label: "Suppliers", Icon: Package },
  ];

  if (loading && projects.length > 0 && Object.keys(quotesByKey).length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center text-neutral-400">
        <Loader2 size={16} className="inline animate-spin mr-1.5" /> Loading projects…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
          <Radar size={20} className="text-orange-500" /> Project Management
        </h1>
        <p className="text-sm text-neutral-500">
          Planning, variations and your contractor &amp; supplier registers, in one place.
        </p>
      </div>

      <AtAGlance projects={projects} quotesByKey={quotesByKey} goTo={setTab} />

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[15px] font-bold shadow-sm transition-colors ${
              tab === key
                ? "bg-orange-600 text-white shadow-md"
                : "bg-blue-950 text-blue-100 hover:bg-blue-900 hover:text-white"
            }`}
          >
            <Icon size={18} /> {label}
          </button>
        ))}
      </div>

      {tab === "planner" && (
        <PlannerTab projects={projects} quotesByKey={quotesByKey} onOpen={onOpen} patchQuote={patchQuote} />
      )}
      {tab === "variations" && (
        <VariationsTab projects={projects} quotesByKey={quotesByKey} onOpen={onOpen} patchQuote={patchQuote} />
      )}
      {(tab === "rfis" || tab === "claims" || tab === "defects") && (
        <ProjectRegisterTab
          projects={projects}
          quotesByKey={quotesByKey}
          onOpen={onOpen}
          patchQuote={patchQuote}
          config={PROJECT_REGISTERS[tab]}
        />
      )}
      {tab === "contractors" && (
        <RegisterTab
          storageKey="boma-contractors"
          title="Contractor register"
          nounSingular="contractor"
          roleLabel="Trade / scope"
          rolePlaceholder="e.g. Formwork, Steel fixing, Pumping"
          seed={DEFAULT_CONTRACTORS}
        />
      )}
      {tab === "suppliers" && (
        <RegisterTab
          storageKey="boma-suppliers"
          title="Supplier register"
          nounSingular="supplier"
          roleLabel="Supplies"
          rolePlaceholder="e.g. Premix concrete, Reo bar &amp; mesh, Formply"
          seed={DEFAULT_SUPPLIERS}
        />
      )}
    </div>
  );
}

/** One-line health strip across every project — each figure jumps to its tab. */
function AtAGlance({ projects, quotesByKey, goTo }) {
  const quotes = projects.map((p) => quotesByKey[p.storageKey] || {});
  const today = new Date().toISOString().slice(0, 10);
  const overdue = quotes.filter((q) => q.planner?.deadline && q.planner.deadline < today).length;
  const openRfis = quotes.reduce((s, q) => s + (q.rfis || []).filter((r) => r.status === "Open").length, 0);
  const openDefects = quotes.reduce((s, q) => s + (q.defects || []).filter((d) => d.status === "Open" || d.status === "In progress").length, 0);
  const approvedVars = quotes.reduce((s, q) => s + (q.variations || []).filter((v) => v.status === "Approved").reduce((t, v) => t + (Number(v.cost) || 0), 0), 0);
  const awaitingPay = quotes.reduce((s, q) => s + (q.claims || []).filter((c) => c.status === "Submitted" || c.status === "Certified").reduce((t, c) => t + (Number(c.certified || c.claimed) || 0), 0), 0);

  const tiles = [
    { label: "Projects overdue", value: overdue, tone: overdue ? "text-red-600" : "text-neutral-700", tab: "planner" },
    { label: "Open RFIs", value: openRfis, tone: openRfis ? "text-amber-600" : "text-neutral-700", tab: "rfis" },
    { label: "Defects outstanding", value: openDefects, tone: openDefects ? "text-red-600" : "text-neutral-700", tab: "defects" },
    { label: "Approved variations", value: money2(approvedVars), tone: "text-green-700", tab: "variations" },
    { label: "Claims awaiting payment", value: money2(awaitingPay), tone: awaitingPay ? "text-amber-600" : "text-neutral-700", tab: "claims" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {tiles.map((t) => (
        <button
          key={t.label}
          onClick={() => goTo(t.tab)}
          className="rounded-xl border border-neutral-200 bg-white shadow-sm px-3 py-2.5 text-left hover:border-orange-400 transition-colors"
        >
          <div className={`font-mono tabular-nums text-lg font-bold ${t.tone}`}>{t.value}</div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-400 font-semibold">{t.label}</div>
        </button>
      ))}
    </div>
  );
}

function PlannerTab({ projects, quotesByKey, onOpen, patchQuote }) {
  const [openComms, setOpenComms] = useState({}); // projectId -> bool

  const rows = useMemo(
    () => projects.map((p) => {
      const quote = quotesByKey[p.storageKey] || {};
      return {
        project: p,
        name: quote.projectName || "Untitled project",
        planner: quote.planner || { deadline: "", priority: defaultPriority(), requirements: "" },
        communications: quote.communications || [],
      };
    }),
    [projects, quotesByKey]
  );

  const patchPlanner = (project, field, value) => {
    const quote = quotesByKey[project.storageKey] || {};
    patchQuote(project, { planner: { ...(quote.planner || {}), [field]: value } });
  };
  const addCommunication = (project, entry) => {
    const quote = quotesByKey[project.storageKey] || {};
    const list = quote.communications || [];
    patchQuote(project, { communications: [{ id: uid(), ...entry }, ...list] });
  };

  const attend = rows
    .filter((r) => isUrgent(r.planner))
    .sort((a, b) => priorityRank(a.planner.priority) - priorityRank(b.planner.priority)
      || (a.planner.deadline || "9999").localeCompare(b.planner.deadline || "9999"));
  const defer = rows
    .filter((r) => !isUrgent(r.planner))
    .sort((a, b) => (a.planner.deadline || "9999").localeCompare(b.planner.deadline || "9999"));

  return (
    <div className="space-y-6">
      {rows.length === 0 && (
        <div className="text-center py-16 text-neutral-400 border-2 border-dashed border-neutral-200 rounded-xl">
          No projects yet — add one from the Dashboard first.
        </div>
      )}

      {attend.length > 0 && (
        <Section title="Attend to now" count={attend.length} tone="urgent">
          {attend.map((r) => (
            <ProjectPlannerCard
              key={r.project.id}
              row={r}
              onOpen={onOpen}
              onPatchPlanner={(field, v) => patchPlanner(r.project, field, v)}
              onAddCommunication={(entry) => addCommunication(r.project, entry)}
              commsOpen={!!openComms[r.project.id]}
              setCommsOpen={(v) => setOpenComms((m) => ({ ...m, [r.project.id]: v }))}
            />
          ))}
        </Section>
      )}

      {defer.length > 0 && (
        <Section title="Can defer" count={defer.length} tone="quiet">
          {defer.map((r) => (
            <ProjectPlannerCard
              key={r.project.id}
              row={r}
              onOpen={onOpen}
              onPatchPlanner={(field, v) => patchPlanner(r.project, field, v)}
              onAddCommunication={(entry) => addCommunication(r.project, entry)}
              commsOpen={!!openComms[r.project.id]}
              setCommsOpen={(v) => setOpenComms((m) => ({ ...m, [r.project.id]: v }))}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

/* ---------- Variations (stored per project on quote.variations) ---------- */

const VARIATION_STATUS_STYLES = {
  Draft: "bg-neutral-100 text-neutral-600",
  Submitted: "bg-blue-100 text-blue-800",
  Approved: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-700",
};

function VariationsTab({ projects, quotesByKey, onOpen, patchQuote }) {
  const rowsByProject = projects.map((p) => {
    const quote = quotesByKey[p.storageKey] || {};
    return { project: p, name: quote.projectName || "Untitled project", variations: quote.variations || [] };
  });

  const patchVariations = (project, variations) => patchQuote(project, { variations });
  const addVariation = (project, existing) => {
    const nextNo = existing.reduce((mx, v) => Math.max(mx, Number(v.no) || 0), 0) + 1;
    patchVariations(project, [
      ...existing,
      { id: uid(), no: nextNo, date: new Date().toISOString().slice(0, 10), description: "", status: "Draft", cost: "", days: "" },
    ]);
  };
  const changeVariation = (project, existing, id, field, value) =>
    patchVariations(project, existing.map((v) => (v.id === id ? { ...v, [field]: value } : v)));
  const removeVariation = (project, existing, id) =>
    patchVariations(project, existing.filter((v) => v.id !== id));

  if (rowsByProject.length === 0) {
    return (
      <div className="text-center py-16 text-neutral-400 border-2 border-dashed border-neutral-200 rounded-xl">
        No projects yet — add one from the Dashboard first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rowsByProject.map(({ project, name, variations }) => {
        const approved = variations.filter((v) => v.status === "Approved")
          .reduce((s, v) => s + (Number(v.cost) || 0), 0);
        return (
          <div key={project.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
              <button
                onClick={() => onOpen(project.id)}
                className="font-semibold text-[14px] text-neutral-900 hover:text-blue-900 flex items-center gap-1"
              >
                {name} <ArrowRight size={13} className="text-neutral-400" />
              </button>
              <div className="text-xs text-neutral-500">
                {variations.length} variation{variations.length === 1 ? "" : "s"}
                {approved !== 0 && <> · approved value <b className="font-mono tabular-nums text-green-700">{money2(approved)}</b></>}
              </div>
            </div>
            <div className="p-3 space-y-2">
              {variations.length === 0 && (
                <div className="text-xs text-neutral-400 italic">No variations logged for this project.</div>
              )}
              {variations.map((v) => (
                <div key={v.id} className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                  <span className="w-12 flex-none text-xs font-mono text-neutral-500 text-center">VO-{String(v.no).padStart(2, "0")}</span>
                  <input
                    type="date"
                    value={v.date || ""}
                    onChange={(e) => changeVariation(project, variations, v.id, "date", e.target.value)}
                    className="w-32 flex-none border border-neutral-200 rounded px-2 py-1 text-xs"
                  />
                  <input
                    value={v.description}
                    onChange={(e) => changeVariation(project, variations, v.id, "description", e.target.value)}
                    placeholder="Variation description (scope change, extra pour, latent condition…)"
                    className="flex-1 min-w-40 border border-neutral-200 rounded px-2 py-1 text-[13px]"
                  />
                  <select
                    value={v.status}
                    onChange={(e) => changeVariation(project, variations, v.id, "status", e.target.value)}
                    className={`w-28 flex-none border border-neutral-200 rounded px-1.5 py-1 text-xs font-medium ${VARIATION_STATUS_STYLES[v.status] || ""}`}
                  >
                    {VARIATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input
                    type="number"
                    value={v.cost}
                    onChange={(e) => changeVariation(project, variations, v.id, "cost", e.target.value)}
                    placeholder="$ cost"
                    className="w-24 flex-none border border-neutral-200 rounded px-2 py-1 text-xs font-mono tabular-nums text-right"
                  />
                  <input
                    type="number"
                    value={v.days}
                    onChange={(e) => changeVariation(project, variations, v.id, "days", e.target.value)}
                    placeholder="days"
                    title="Time impact (days)"
                    className="w-16 flex-none border border-neutral-200 rounded px-2 py-1 text-xs font-mono tabular-nums text-right"
                  />
                  <button
                    onClick={() => removeVariation(project, variations, v.id)}
                    className="text-neutral-300 hover:text-red-500 transition-colors flex-none"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addVariation(project, variations)}
                className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700"
              >
                <Plus size={13} /> Add variation
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------- Per-project registers: RFIs, Progress Claims, Defects -------
   One config-driven table component instead of three near-identical tabs.
   Rows live on each project's own quote object (quote.rfis / .claims /
   .defects) so they save and sync exactly like variations do. */

const PROJECT_REGISTERS = {
  rfis: {
    field: "rfis", prefix: "RFI", addLabel: "Add RFI", empty: "No RFIs raised for this project.",
    columns: [
      { key: "date", type: "date", title: "Date raised" },
      { key: "subject", type: "text", flex: true, placeholder: "Question / information required" },
      { key: "to", type: "text", w: "w-44", placeholder: "Sent to (architect, engineer…)" },
      { key: "due", type: "date", title: "Response due" },
      { key: "status", type: "select", options: ["Open", "Answered", "Closed"],
        styles: { Open: "bg-amber-100 text-amber-800", Answered: "bg-blue-100 text-blue-800", Closed: "bg-green-100 text-green-800" } },
    ],
    summary: (rows) => { const n = rows.filter((r) => r.status === "Open").length; return n ? `${n} open` : ""; },
  },
  claims: {
    field: "claims", prefix: "PC", addLabel: "Add progress claim", empty: "No progress claims for this project.",
    columns: [
      { key: "date", type: "date", title: "Claim date" },
      { key: "period", type: "text", flex: true, placeholder: "Works period / claim description" },
      { key: "claimed", type: "number", w: "w-28", placeholder: "$ claimed" },
      { key: "certified", type: "number", w: "w-28", placeholder: "$ certified" },
      { key: "status", type: "select", options: ["Draft", "Submitted", "Certified", "Paid"],
        styles: { Draft: "bg-neutral-100 text-neutral-600", Submitted: "bg-blue-100 text-blue-800", Certified: "bg-amber-100 text-amber-800", Paid: "bg-green-100 text-green-800" } },
    ],
    summary: (rows) => {
      const paid = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + (Number(r.certified || r.claimed) || 0), 0);
      return paid ? `paid to date ${money2(paid)}` : "";
    },
  },
  defects: {
    field: "defects", prefix: "DEF", addLabel: "Add defect", empty: "No defects recorded for this project.",
    columns: [
      { key: "date", type: "date", title: "Raised" },
      { key: "description", type: "text", flex: true, placeholder: "Defect & location (e.g. honeycombing — north wall footing)" },
      { key: "assigned", type: "text", w: "w-40", placeholder: "Assigned to" },
      { key: "due", type: "date", title: "Rectify by" },
      { key: "status", type: "select", options: ["Open", "In progress", "Rectified", "Closed"],
        styles: { Open: "bg-red-100 text-red-700", "In progress": "bg-amber-100 text-amber-800", Rectified: "bg-blue-100 text-blue-800", Closed: "bg-green-100 text-green-800" } },
    ],
    summary: (rows) => { const n = rows.filter((r) => r.status === "Open" || r.status === "In progress").length; return n ? `${n} outstanding` : ""; },
  },
};

// Plain CSV download for any register — the same escape-everything rule the
// Excel export uses. Runs in the real browser app, so downloads just work.
function downloadCsv(filename, header, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ProjectRegisterTab({ projects, quotesByKey, onOpen, patchQuote, config }) {
  const rowsByProject = projects.map((p) => {
    const quote = quotesByKey[p.storageKey] || {};
    return { project: p, name: quote.projectName || "Untitled project", rows: quote[config.field] || [] };
  });

  const patchRows = (project, rows) => patchQuote(project, { [config.field]: rows });
  const addRow = (project, existing) => {
    const nextNo = existing.reduce((mx, r) => Math.max(mx, Number(r.no) || 0), 0) + 1;
    const statusCol = config.columns.find((c) => c.type === "select");
    const blank = { id: uid(), no: nextNo, status: statusCol ? statusCol.options[0] : "" };
    config.columns.forEach((c) => { if (!(c.key in blank)) blank[c.key] = c.type === "date" && c.key === "date" ? new Date().toISOString().slice(0, 10) : ""; });
    patchRows(project, [...existing, blank]);
  };
  const changeRow = (project, existing, id, key, value) =>
    patchRows(project, existing.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  const removeRow = (project, existing, id) => patchRows(project, existing.filter((r) => r.id !== id));

  const exportAll = () => {
    const header = ["Project", "No", ...config.columns.map((c) => c.title || c.placeholder || c.key)];
    const rows = rowsByProject.flatMap(({ name, rows }) =>
      rows.map((r) => [name, `${config.prefix}-${String(r.no).padStart(2, "0")}`, ...config.columns.map((c) => r[c.key] ?? "")])
    );
    downloadCsv(`boma-${config.field}.csv`, header, rows);
  };

  if (rowsByProject.length === 0) {
    return (
      <div className="text-center py-16 text-neutral-400 border-2 border-dashed border-neutral-200 rounded-xl">
        No projects yet — add one from the Dashboard first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={exportAll} className="text-xs font-semibold text-blue-900 hover:text-blue-700">
          ⬇ Export all as CSV
        </button>
      </div>
      {rowsByProject.map(({ project, name, rows }) => {
        const note = config.summary(rows);
        return (
          <div key={project.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
              <button
                onClick={() => onOpen(project.id)}
                className="font-semibold text-[14px] text-neutral-900 hover:text-blue-900 flex items-center gap-1"
              >
                {name} <ArrowRight size={13} className="text-neutral-400" />
              </button>
              <div className="text-xs text-neutral-500">
                {rows.length} record{rows.length === 1 ? "" : "s"}{note && <> · <b className="text-neutral-700">{note}</b></>}
              </div>
            </div>
            <div className="p-3 space-y-2">
              {rows.length === 0 && <div className="text-xs text-neutral-400 italic">{config.empty}</div>}
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                  <span className="w-14 flex-none text-xs font-mono text-neutral-500 text-center">
                    {config.prefix}-{String(r.no).padStart(2, "0")}
                  </span>
                  {config.columns.map((c) => {
                    if (c.type === "select") {
                      return (
                        <select
                          key={c.key}
                          value={r[c.key] || c.options[0]}
                          onChange={(e) => changeRow(project, rows, r.id, c.key, e.target.value)}
                          className={`w-32 flex-none border border-neutral-200 rounded px-1.5 py-1 text-xs font-medium ${c.styles[r[c.key]] || ""}`}
                        >
                          {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      );
                    }
                    if (c.type === "date") {
                      return (
                        <input
                          key={c.key}
                          type="date"
                          title={c.title}
                          value={r[c.key] || ""}
                          onChange={(e) => changeRow(project, rows, r.id, c.key, e.target.value)}
                          className="w-32 flex-none border border-neutral-200 rounded px-2 py-1 text-xs"
                        />
                      );
                    }
                    if (c.type === "number") {
                      return (
                        <input
                          key={c.key}
                          type="number"
                          placeholder={c.placeholder}
                          value={r[c.key] ?? ""}
                          onChange={(e) => changeRow(project, rows, r.id, c.key, e.target.value)}
                          className={`${c.w || "w-28"} flex-none border border-neutral-200 rounded px-2 py-1 text-xs font-mono tabular-nums text-right`}
                        />
                      );
                    }
                    return (
                      <input
                        key={c.key}
                        placeholder={c.placeholder}
                        value={r[c.key] || ""}
                        onChange={(e) => changeRow(project, rows, r.id, c.key, e.target.value)}
                        className={`${c.flex ? "flex-1 min-w-40" : `${c.w || "w-36"} flex-none`} border border-neutral-200 rounded px-2 py-1 text-[13px]`}
                      />
                    );
                  })}
                  <button
                    onClick={() => removeRow(project, rows, r.id)}
                    className="text-neutral-300 hover:text-red-500 transition-colors flex-none"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addRow(project, rows)}
                className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700"
              >
                <Plus size={13} /> {config.addLabel}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Contractor & Supplier registers (global, shared across projects) ---- */

function RegisterTab({ storageKey, title, nounSingular, roleLabel, rolePlaceholder, seed = [] }) {
  const [entries, setEntries, status] = useStoredState(storageKey, seed);

  const add = () =>
    setEntries((list) => [...list, { id: uid(), name: "", role: "", contact: "", phone: "", email: "", notes: "" }]);
  const change = (id, field, v) =>
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, [field]: v } : e)));
  const remove = (id) => setEntries((list) => list.filter((e) => e.id !== id));

  if (status === "loading") {
    return (
      <div className="py-16 text-center text-neutral-400">
        <Loader2 size={16} className="inline animate-spin mr-1.5" /> Loading {title.toLowerCase()}…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between gap-3">
        <span className="font-semibold text-[14px] text-neutral-900">{title}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => downloadCsv(
              `boma-${nounSingular}s.csv`,
              ["Company / name", roleLabel, "Contact", "Phone", "Email", "Notes"],
              entries.map((e) => [e.name, e.role, e.contact, e.phone, e.email, e.notes])
            )}
            className="text-xs font-semibold text-blue-900 hover:text-blue-700"
          >
            ⬇ CSV
          </button>
          <span className="text-xs text-neutral-500">{entries.length} {nounSingular}{entries.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="p-3 overflow-x-auto">
        {entries.length === 0 && (
          <div className="text-xs text-neutral-400 italic mb-2">No {nounSingular}s registered yet.</div>
        )}
        {entries.length > 0 && (
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-neutral-400">
                <th className="pb-1.5 pr-2">Company / name</th>
                <th className="pb-1.5 pr-2">{roleLabel}</th>
                <th className="pb-1.5 pr-2">Contact person</th>
                <th className="pb-1.5 pr-2">Phone</th>
                <th className="pb-1.5 pr-2">Email</th>
                <th className="pb-1.5 pr-2">Notes</th>
                <th className="pb-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="py-1 pr-2"><RegInput value={e.name} onChange={(v) => change(e.id, "name", v)} placeholder="Name" /></td>
                  <td className="py-1 pr-2"><RegInput value={e.role} onChange={(v) => change(e.id, "role", v)} placeholder={rolePlaceholder} /></td>
                  <td className="py-1 pr-2"><RegInput value={e.contact} onChange={(v) => change(e.id, "contact", v)} placeholder="Contact" /></td>
                  <td className="py-1 pr-2"><RegInput value={e.phone} onChange={(v) => change(e.id, "phone", v)} placeholder="Phone" /></td>
                  <td className="py-1 pr-2"><RegInput value={e.email} onChange={(v) => change(e.id, "email", v)} placeholder="Email" /></td>
                  <td className="py-1 pr-2"><RegInput value={e.notes} onChange={(v) => change(e.id, "notes", v)} placeholder="Notes (rates, reliability, insurances…)" /></td>
                  <td className="py-1">
                    <button onClick={() => remove(e.id)} className="text-neutral-300 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button onClick={add} className="mt-2 flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700">
          <Plus size={13} /> Add {nounSingular}
        </button>
      </div>
    </div>
  );
}

function RegInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-neutral-200 rounded px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-orange-400"
    />
  );
}

function Section({ title, count, tone, children }) {
  return (
    <div>
      <div className={`flex items-center gap-2 mb-2 text-sm font-semibold ${tone === "urgent" ? "text-red-600" : "text-neutral-500"}`}>
        {tone === "urgent" && <Clock size={15} />}
        {title} <span className="text-xs font-normal text-neutral-400">({count})</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ProjectPlannerCard({ row, onOpen, onPatchPlanner, onAddCommunication, commsOpen, setCommsOpen }) {
  const { project, name, planner, communications } = row;
  const style = PLANNER_PRIORITY_STYLES[planner.priority] || PLANNER_PRIORITY_STYLES[defaultPriority()] || PLANNER_PRIORITY_STYLES.Medium;
  const due = daysLabel(planner.deadline);
  const [open, setOpen] = useState(false);
  const [logging, setLogging] = useState(false);
  const [draft, setDraft] = useState({ date: new Date().toISOString().slice(0, 10), contact: "", channel: CHANNELS[0], summary: "" });

  const submitLog = () => {
    if (!draft.summary.trim()) return;
    onAddCommunication(draft);
    setDraft({ date: new Date().toISOString().slice(0, 10), contact: "", channel: CHANNELS[0], summary: "" });
    setLogging(false);
    setCommsOpen(true);
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start justify-between gap-3 flex-wrap p-4 text-left">
        <div className="min-w-0 flex items-start gap-2">
          {open ? <ChevronDown size={16} className="text-neutral-400 mt-0.5 flex-none" /> : <ChevronRight size={16} className="text-neutral-400 mt-0.5 flex-none" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full flex-none ${style.dot}`} />
              <span className="font-semibold text-[15px] text-neutral-900">{name}</span>
            </div>
            {due && <div className={`text-xs mt-0.5 ${due.cls}`}>{due.text}</div>}
          </div>
        </div>
        <span
          onClick={(e) => { e.stopPropagation(); onOpen(project.id); }}
          className="flex items-center gap-1 text-xs font-medium text-blue-900 hover:text-blue-700 flex-none"
        >
          Open project <ArrowRight size={13} />
        </span>
      </button>

      {open && (
      <div className="px-4 pb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <label className="block text-xs">
          <span className="block text-neutral-400 mb-1">Deadline</span>
          <input
            type="date"
            value={planner.deadline || ""}
            onChange={(e) => onPatchPlanner("deadline", e.target.value)}
            className="w-full border border-neutral-200 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="block text-neutral-400 mb-1">Priority</span>
          <select
            value={planner.priority || defaultPriority()}
            onChange={(e) => onPatchPlanner("priority", e.target.value)}
            className={`w-full border border-neutral-200 rounded px-2 py-1 text-sm font-medium ${style.text}`}
          >
            {PLANNER_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      <label className="block text-xs mt-3">
        <span className="block text-neutral-400 mb-1">Requirements / what's needed to move this forward</span>
        <textarea
          defaultValue={planner.requirements || ""}
          onBlur={(e) => onPatchPlanner("requirements", e.target.value)}
          rows={2}
          placeholder="e.g. waiting on structural drawings from architect, client to confirm scope"
          className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
        />
      </label>

      <div className="mt-3 border-t border-neutral-100 pt-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCommsOpen(!commsOpen)}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
          >
            Communications ({communications.length}) {commsOpen ? "▲" : "▼"}
          </button>
          <button
            onClick={() => setLogging(!logging)}
            className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700"
          >
            <MessageSquarePlus size={13} /> Log communication
          </button>
        </div>

        {logging && (
          <div className="mt-2 p-2 bg-neutral-50 rounded-lg border border-neutral-200 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} className="border border-neutral-200 rounded px-2 py-1 text-xs" />
              <input placeholder="Contact" value={draft.contact} onChange={(e) => setDraft((d) => ({ ...d, contact: e.target.value }))} className="border border-neutral-200 rounded px-2 py-1 text-xs" />
              <select value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))} className="border border-neutral-200 rounded px-2 py-1 text-xs">
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea
              placeholder="Summary"
              value={draft.summary}
              onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
              rows={2}
              className="w-full border border-neutral-200 rounded px-2 py-1 text-xs"
            />
            <button onClick={submitLog} className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold">
              Add
            </button>
          </div>
        )}

        {commsOpen && (
          <div className="mt-2 space-y-1.5">
            {communications.length === 0 && <div className="text-xs text-neutral-400 italic">No communications logged yet.</div>}
            {communications.map((c) => (
              <div key={c.id} className="text-xs text-neutral-600 flex gap-2">
                <span className="text-neutral-400 flex-none">{c.date}</span>
                <span className="font-medium flex-none">{c.channel}{c.contact ? ` · ${c.contact}` : ""}</span>
                <span className="text-neutral-500">{c.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
