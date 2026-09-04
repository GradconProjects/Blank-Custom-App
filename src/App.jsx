import { useState, useMemo, useEffect } from "react";
import { Settings2, ArrowLeft, Printer, ListPlus, FileSpreadsheet, LayoutDashboard, Radar, FolderOpen } from "lucide-react";
import { ELEMENT_TYPES, QUOTE_STATUSES, QUOTE_STATUS_STYLES } from "./data/catalog.js";
import { defaultRates, newElementItem, computeGrandTotal, uid, money, rateKey } from "./lib/costing.js";
import { buildQuoteExcelHtml, quoteExcelFilename, buildQuoteCsv } from "./lib/exportQuote.js";
import { useStoredState } from "./lib/storage.js";
import { PROJECTS_INDEX_KEY, newProjectEntry, migrateLegacyQuote, deleteQuote, writeQuote, readQuotes, publishQuoteToCostPlanner } from "./lib/projects.js";
import { ESTIMATE_EXPORT_KEY, buildImportFromEstimate } from "./lib/estimateImport.js";
import { SaveBadge } from "./components/atoms.jsx";
import AddElementBar from "./components/AddElementBar.jsx";
import ElementCard from "./components/ElementCard.jsx";
import QuoteSummary from "./components/QuoteSummary.jsx";
import RatesModal from "./components/RatesModal.jsx";
import Dashboard from "./components/Dashboard.jsx";
import PlannerView from "./components/PlannerView.jsx";
import ProjectFolderView from "./components/ProjectFolderView.jsx";
import PrintQuoteReport from "./components/PrintQuoteReport.jsx";
import ExternalQuoteReport from "./components/ExternalQuoteReport.jsx";
import TenderQuoteReport from "./components/TenderQuoteReport.jsx";
import ExportExcelModal from "./components/ExportExcelModal.jsx";
import ImportFlagsBanner from "./components/ImportFlagsBanner.jsx";
import ManageElementTypesModal from "./components/ManageElementTypesModal.jsx";
import ProjectGeometryPanel from "./components/ProjectGeometryPanel.jsx";

const OFFICE_COMMS_KEY = "gradcon-office-communications";
const INITIAL_VIEW_KEY = "gradcon-quotes-initial-view";

export const CUSTOM_ELEMENT_TYPES_KEY = "gradcon-custom-element-types";
// Per-browser only (never synced) — which project's editor a plain page refresh
// should land back on, deliberately not shared across devices/users (someone
// else refreshing shouldn't get yanked into whatever project THIS browser had
// open).
const ACTIVE_PROJECT_KEY = "gradcon-active-project";

// New-project overheads/contingency seed from the portal Settings modal's
// stored preferences (entered there as whole %, stored under
// "gradcon-preferences"), falling back to the historical 8%/5%. Only NEW
// projects read this — existing quotes keep whatever they were saved with.
const prefPct = (key, fallback) => {
  try {
    const p = JSON.parse(localStorage.getItem("gradcon-preferences")) || {};
    return Number.isFinite(p[key]) ? p[key] / 100 : fallback;
  } catch {
    return fallback;
  }
};

const prefStatus = () => {
  try {
    const p = JSON.parse(localStorage.getItem("gradcon-preferences")) || {};
    return QUOTE_STATUSES.includes(p.quotesDefaultStatus) ? p.quotesDefaultStatus : QUOTE_STATUSES[0];
  } catch {
    return QUOTE_STATUSES[0];
  }
};

const blankQuote = () => ({
  projectName: "",
  clientName: "", // the project's owner/client — shown on the Dashboard so owners are easy to spot
  projectDate: new Date().toISOString().slice(0, 10),
  gfa: undefined,
  overheadPct: prefPct("overheadPct", 0.08),
  contingencyPct: prefPct("contingencyPct", 0.05),
  status: prefStatus(),
  items: [],
});

// Read once per mount (both activeId and view below need the same answer) —
// portal-shell.html's Planner/Project Folder welcome-screen tiles set this
// key then force-reload the Quotes iframe, same "write to localStorage,
// force a fresh mount" bridge the Estimates "Publish to Quote" flow already
// uses. Clearing it here means a later plain reload of Quotes (no flag set)
// falls through to the normal remembered-project/Dashboard behaviour.
function takeInitialView() {
  try {
    const initial = window.localStorage.getItem(INITIAL_VIEW_KEY);
    if (initial === "planner" || initial === "folder") {
      window.localStorage.removeItem(INITIAL_VIEW_KEY);
      return initial;
    }
  } catch { /* best-effort */ }
  return null;
}

export default function App() {
  const [projects, setProjects, projectsStatus, saveProjectsNow] = useStoredState(PROJECTS_INDEX_KEY, []);
  const initialRates = useMemo(() => defaultRates(), []);
  const [rates, setRates, ratesStatus] = useStoredState("gradcon-rates", initialRates);
  const [initialView] = useState(takeInitialView);
  const [activeId, setActiveId] = useState(() => {
    // A pending Planner/Project Folder jump always wins over whatever project
    // this browser last had open — otherwise ProjectEditor would take over
    // and the tab bar (where Planner/Project Folder live) would never render.
    if (initialView) return null;
    try {
      // Portal Settings "reopen the last project" toggle — explicitly off
      // means every load lands on the Dashboard instead.
      const p = JSON.parse(localStorage.getItem("gradcon-preferences")) || {};
      if (p.quotesRememberProject === false) return null;
      return window.localStorage.getItem(ACTIVE_PROJECT_KEY) || null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (activeId) window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeId);
      else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch { /* best-effort */ }
  }, [activeId]);
  // One-time formwork price corrections: Conventional $150 → $60/m² and
  // Edgeform $50 → $8/lm. A stored rates blob carrying the OLD SEED value
  // (any rates-modal save persisted the whole seeded object) gets the new
  // figure once; any other stored figure is a deliberate edit — untouched.
  useEffect(() => {
    if (ratesStatus === "loading") return;
    const fixes = [
      [rateKey("FORMWORK", "Conventional", "m2"), 150, 60],
      [rateKey("FORMWORK", "Edgeform", "m"), 50, 8],
    ];
    const stale = fixes.filter(([key, oldSeed]) => rates[key] && rates[key].unitCost === oldSeed);
    if (stale.length) {
      const next = { ...rates };
      stale.forEach(([key, , now]) => { next[key] = { ...next[key], unitCost: now }; });
      setRates(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratesStatus]);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [elementTypesOpen, setElementTypesOpen] = useState(false);
  // Which top-level tab shows when no project is open — Dashboard, Planner
  // or Project Folder. Opening a project (activeId set) always takes over
  // regardless of this, same as before the tabs existed.
  const [view, setView] = useState(() => initialView || "dashboard");
  const [officeComms, setOfficeComms] = useStoredState(OFFICE_COMMS_KEY, []);

  // Self-service catalog extension (see ManageElementTypesModal) — types
  // added here merge with the built-in ELEMENT_TYPES everywhere the Add-
  // Element dropdown, Quote Summary fold and print report need the full
  // list, without ever touching data/catalog.js itself.
  const [customTypes, setCustomTypes] = useStoredState(CUSTOM_ELEMENT_TYPES_KEY, []);
  const allElementTypes = useMemo(() => [...ELEMENT_TYPES, ...customTypes], [customTypes]);
  const allCategoryOrder = useMemo(() => [...new Set(allElementTypes.map((t) => t.category))], [allElementTypes]);
  const allSectionOrder = useMemo(() => [...new Set(allElementTypes.map((t) => t.section))], [allElementTypes]);

  // One-time migration for installs that had a single quote under the old
  // fixed "gradcon-quote" key before multi-project support existed.
  useEffect(() => {
    if (projectsStatus === "loading") return;
    if (projects.length === 0) {
      migrateLegacyQuote().then((migrated) => {
        if (migrated.length) setProjects(migrated);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsStatus]);

  // Picks up a takeoff published from the Estimates tool (see
  // lib/estimateImport.js). Both apps share this browser's localStorage
  // when hosted together, so the Estimates tool just leaves its export
  // under ESTIMATE_EXPORT_KEY — this turns that into a project. A re-publish
  // of the SAME Estimates project (tracked by estimateSessionId, carried in
  // the export payload) updates that project's items/flags in place instead
  // of creating a duplicate every time — that's what makes "keep editing in
  // Estimates, see it land here without re-entering anything" work. Runs on
  // mount AND live via the "storage" event, which fires here (a different
  // browsing context to the Estimates iframe that wrote it) the moment
  // Estimates auto-publishes — no reload needed.
  useEffect(() => {
    if (projectsStatus === "loading") return;

    const importFromEstimateExport = async (estimateExport) => {
      const { quote: freshQuote } = buildImportFromEstimate(estimateExport);
      const estimateSessionId = estimateExport?.project?.estimateSessionId || null;
      freshQuote.importMeta = { ...freshQuote.importMeta, estimateSessionId };

      const quotesByKey = await readQuotes(projects.map((p) => p.storageKey));
      // Match the already-imported project for this takeoff: primarily by
      // estimateSessionId; failing that (a takeoff saved before session ids
      // existed, or a .json re-imported into Estimates under a fresh id) by
      // the project name of a previous import. Either way the publish MERGES
      // into that project — quantities/flags refresh, while Quotes-side
      // settings (rates, GFA, margins, markups) are kept — instead of piling
      // up "Project X (from Estimates)" duplicates.
      const existing =
        (estimateSessionId &&
          projects.find(
            (p) => quotesByKey[p.storageKey]?.importMeta?.estimateSessionId === estimateSessionId
          )) ||
        projects.find((p) => {
          const q = quotesByKey[p.storageKey];
          return q?.importMeta?.importedAt && q?.projectName === freshQuote.projectName;
        });
      if (existing) {
        const prev = quotesByKey[existing.storageKey];
        // Estimates owns the bridge-created cards (fromEstimate) — those are
        // replaced with the fresh publish. Cards the estimator added by hand
        // on this project are kept alongside them. (Projects imported before
        // the fromEstimate tag existed have no way to tell the two apart, so
        // they keep the original replace-everything behaviour.)
        const prevItems = Array.isArray(prev.items) ? prev.items : [];
        const postTagEra = prevItems.some((it) => it.fromEstimate);
        const manualKept = postTagEra ? prevItems.filter((it) => !it.fromEstimate) : [];
        await writeQuote(existing.storageKey, {
          ...prev,
          items: [...freshQuote.items, ...manualKept],
          importFlags: freshQuote.importFlags,
          importMeta: freshQuote.importMeta,
        });
        return;
      }
      const entry = newProjectEntry();
      await writeQuote(entry.storageKey, freshQuote);
      setProjects((ps) => [...ps, entry]);
      setActiveId(entry.id);
    };

    const consumeExport = () => {
      let raw;
      try {
        raw = window.localStorage.getItem(ESTIMATE_EXPORT_KEY);
      } catch {
        return;
      }
      if (!raw) return;
      (async () => {
        try {
          await importFromEstimateExport(JSON.parse(raw));
        } finally {
          try { window.localStorage.removeItem(ESTIMATE_EXPORT_KEY); } catch { /* best-effort */ }
        }
      })();
    };

    consumeExport();
    const onStorage = (e) => { if (e.key === ESTIMATE_EXPORT_KEY && e.newValue) consumeExport(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsStatus, projects]);

  const activeProject = projects.find((p) => p.id === activeId) || null;

  const createProject = () => {
    const entry = newProjectEntry();
    setProjects((ps) => [...ps, entry]);
    setActiveId(entry.id);
  };

  // Dashboard.jsx gates this behind its own two-click confirm UI (not a
  // native confirm() dialog — those can be silently blocked in a
  // sandboxed/embedded iframe, see its comment) before ever calling this.
  const deleteProject = (id) => {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    deleteQuote(target.storageKey);
    setProjects((ps) => ps.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
  };

  if (projectsStatus === "loading") {
    return <div className="min-h-screen bg-neutral-100" />;
  }

  if (!activeProject) {
    return (
      <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans">
        <div className="sticky top-0 z-30 bg-blue-950 text-white shadow-md">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold">
              Gradcon Concrete Constructions
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setElementTypesOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors"
              >
                <ListPlus size={16} /> Element Types
              </button>
              <button
                onClick={() => setRatesOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors"
              >
                <Settings2 size={16} /> Rates
              </button>
            </div>
          </div>
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 border-t border-blue-900/60">
            {[
              { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
              { key: "planner", label: "Project Management", Icon: Radar },
              { key: "folder", label: "Gradcon Vault", Icon: FolderOpen },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors ${
                  view === key
                    ? "bg-orange-600 text-white"
                    : "bg-blue-900 text-blue-100 hover:bg-blue-800 hover:text-white"
                }`}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>
        {view === "dashboard" && (
          <Dashboard projects={projects} rates={rates} onOpen={setActiveId} onCreate={createProject} onDelete={deleteProject} />
        )}
        {view === "planner" && <PlannerView projects={projects} onOpen={setActiveId} />}
        {view === "folder" && (
          <ProjectFolderView projects={projects} officeComms={officeComms} setOfficeComms={setOfficeComms} onOpen={setActiveId} />
        )}
        {ratesOpen && <RatesModal rates={rates} setRates={setRates} onClose={() => setRatesOpen(false)} />}
        {elementTypesOpen && (
          <ManageElementTypesModal customTypes={customTypes} setCustomTypes={setCustomTypes} onClose={() => setElementTypesOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <ProjectEditor
      key={activeProject.id}
      project={activeProject}
      rates={rates}
      setRates={setRates}
      ratesStatus={ratesStatus}
      saveProjectsNow={saveProjectsNow}
      onBack={() => setActiveId(null)}
      elementTypes={allElementTypes}
      categoryOrder={allCategoryOrder}
      sectionOrder={allSectionOrder}
      customTypes={customTypes}
      setCustomTypes={setCustomTypes}
    />
  );
}

function ProjectEditor({ project, rates, setRates, ratesStatus, saveProjectsNow, onBack, elementTypes, categoryOrder, sectionOrder, customTypes, setCustomTypes }) {
  // Editing a labour rate on any element's crew sheet writes the SAME rates
  // store the Rates modal shows — one library, one figure, everywhere.
  const setLabourRate = (res, v) => {
    const key = rateKey("LABOUR", res.name, res.unit);
    setRates({ ...rates, [key]: { ...(rates[key] || {}), unitCost: v === undefined || v === "" ? res.rate : Number(v) } });
  };
  // Same one-library principle for material rates edited in place on a
  // category row (the Holcim service fees): the edit lands on the
  // exact key the Rates modal shows; clearing restores the catalog default.
  const setMaterialRate = (key, v, fallback) => {
    setRates({ ...rates, [key]: { ...(rates[key] || {}), unitCost: v === undefined || v === "" ? fallback : Number(v) } });
  };
  const [quote, setQuote, quoteStatus, saveQuoteNow] = useStoredState(project.storageKey, blankQuote());

  // Mirrors the project's name/GFA into Cost Planner automatically, the same way
  // Estimates already auto-publishes as you edit (see estimateImport.js's sibling
  // bridge) — so a project started here shows up in Cost Planner's list without
  // re-typing it. Debounced so rapid typing in the project name field doesn't spam
  // a Supabase write on every keystroke; silent/best-effort, same as autosave. Must
  // depend on quote.items too, not just projectName/gfa — otherwise filling in line
  // quantities after naming the project never re-triggers this, and Cost Planner only
  // ever sees whatever quantities existed at the moment the name/GFA was last touched
  // (usually none, since naming a project normally happens before quantities are
  // entered) — a real bug this had until quantities visibly never showed up there.
  useEffect(() => {
    if (!quote.projectName) return;
    const t = setTimeout(() => { publishQuoteToCostPlanner(project.id, quote); }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, quote.projectName, quote.gfa, quote.items]);

  const [ratesOpen, setRatesOpen] = useState(false);
  const [elementTypesOpen, setElementTypesOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [externalQuoteOpen, setExternalQuoteOpen] = useState(false);
  const [tenderQuoteOpen, setTenderQuoteOpen] = useState(false);
  // Only one of the two printable reports' `hidden print:block` copies should
  // ever be in the DOM at once — otherwise Ctrl+P/window.print() would print
  // both concatenated together. Whichever button was last clicked wins.
  const [printTarget, setPrintTarget] = useState("internal"); // "internal" | "external"
  const [exportCsv, setExportCsv] = useState(null); // { filename, html, plainText } | null

  const items = quote.items || [];
  const setItems = (updater) =>
    setQuote((q) => ({ ...q, items: typeof updater === "function" ? updater(q.items) : updater }));

  const addElement = (typeId) => {
    const type = elementTypes.find((t) => t.id === typeId);
    if (!type) return;
    setItems((its) => [...its, newElementItem(type)]);
  };
  const updateItem = (id, next) => setItems((its) => its.map((it) => (it.id === id ? next : it)));
  const removeItem = (id) => setItems((its) => its.filter((it) => it.id !== id));
  const reorderItems = (draggedId, targetId) =>
    setItems((its) => {
      if (draggedId === targetId) return its;
      const from = its.findIndex((it) => it.id === draggedId);
      const to = its.findIndex((it) => it.id === targetId);
      if (from === -1 || to === -1) return its;
      const next = [...its];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  const duplicateItem = (id) =>
    setItems((its) => {
      const src = its.find((it) => it.id === id);
      if (!src) return its;
      const idx = its.findIndex((it) => it.id === id);
      const clone = {
        ...src,
        id: uid(),
        label: src.label + " (copy)",
        tasks: src.tasks.map((t) => ({ ...t, id: uid() })),
        additional: src.additional.map((a) => ({ ...a, id: uid() })),
      };
      const next = [...its];
      next.splice(idx + 1, 0, clone);
      return next;
    });

  const grandTotal = useMemo(() => computeGrandTotal(items, rates), [items, rates]);

  const exportExcel = () => {
    const filename = quoteExcelFilename(quote);
    const html = buildQuoteExcelHtml(quote, items, rates, categoryOrder, sectionOrder);
    const plainText = buildQuoteCsv(quote, items, rates, categoryOrder, sectionOrder);
    // Same "always show a working fallback" pattern as Print/PDF above: a
    // script-triggered blob download can be silently blocked in a
    // sandboxed iframe, with no reliable way to detect that it failed.
    try {
      const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { /* fall through to the preview modal below regardless */ }
    setExportCsv({ filename, html, plainText });
  };

  const overallStatus =
    quoteStatus === "error" || ratesStatus === "error" ? "error"
    : quoteStatus === "saving" || ratesStatus === "saving" ? "saving"
    : quoteStatus === "unavailable" || ratesStatus === "unavailable" ? "unavailable"
    : quoteStatus === "loading" || ratesStatus === "loading" ? "loading"
    : "saved";

  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white text-neutral-900 font-sans">
      <div className="print:hidden sticky top-0 z-30 bg-blue-950 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-2 py-2 rounded-lg hover:bg-blue-900 text-blue-200 hover:text-white text-sm flex-none transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold">Gradcon Concrete Constructions</div>
            {/* The client/owner is NOT edited here — it lives beside the
                project name on the Projects Dashboard (Dashboard.jsx), which
                is where projects are scanned by owner. */}
            <input
              value={quote.projectName}
              onChange={(e) => setQuote((q) => ({ ...q, projectName: e.target.value }))}
              placeholder="Project name — click to edit"
              className="bg-transparent border-0 text-white font-semibold text-base w-full focus:outline-none focus:underline decoration-orange-400 placeholder:text-blue-400"
            />
          </div>
          <div className="text-right flex-none">
            <div className="text-[10px] uppercase tracking-widest text-blue-300">Live Quote Total (ex GST)</div>
            <div className="font-mono tabular-nums text-2xl font-bold text-orange-400">{money(grandTotal)}</div>
          </div>
          <button
            onClick={() => {
              setPrintTarget("internal");
              // window.print() can be silently blocked (no-op, no throw) when
              // this app is embedded in a sandboxed iframe — try it, but
              // always also open the on-screen preview so there's a working
              // fallback regardless of whether the native dialog opened.
              try { window.print(); } catch (e) { /* fall through to preview */ }
              setPrintPreviewOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
            title="Gradcon's own cost/material/labour breakdown, for internal use"
          >
            <Printer size={16} /> Internal Quote
          </button>
          <button
            onClick={() => {
              setPrintTarget("external");
              setExternalQuoteOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
            title="The client-facing quotation letter — editable scope, inclusions/exclusions, terms and signature"
          >
            <Printer size={16} /> External Quote
          </button>
          <button
            onClick={() => {
              setPrintTarget("tender");
              setTenderQuoteOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
            title="The full tender quotation document — Gradcon's real quotation layout, every line item and section editable, seeded from this quote and its estimating quantities, with a print preview. Never includes markup drawings."
          >
            <Printer size={16} /> Tender Quote
          </button>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
            title="Export as a formatted spreadsheet (opens in Excel)"
          >
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button
            onClick={() => setElementTypesOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
          >
            <ListPlus size={16} /> Element Types
          </button>
          <button
            onClick={() => setRatesOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
          >
            <Settings2 size={16} /> Rates
          </button>
        </div>
      </div>

      <div className="print:hidden max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>Date:</span>
          <input
            type="date"
            value={quote.projectDate}
            onChange={(e) => setQuote((q) => ({ ...q, projectDate: e.target.value }))}
            className="border border-neutral-200 rounded px-2 py-1 text-xs"
          />
          <span>Status:</span>
          <select
            value={quote.status || QUOTE_STATUSES[0]}
            onChange={(e) => setQuote((q) => ({ ...q, status: e.target.value }))}
            className={`border border-neutral-200 rounded px-2 py-1 text-xs font-semibold ${QUOTE_STATUS_STYLES[quote.status || QUOTE_STATUSES[0]].text} ${QUOTE_STATUS_STYLES[quote.status || QUOTE_STATUSES[0]].bg}`}
          >
            {QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <SaveBadge status={overallStatus} />
          <button
            type="button"
            onClick={() => { saveQuoteNow(); saveProjectsNow(); publishQuoteToCostPlanner(project.id, quote); }}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-orange-600 text-white hover:bg-orange-700"
            title="Save this quote's current work, its place in the Projects Dashboard, and push it to Cost Planner's BOQ immediately"
          >
            Save
          </button>
        </div>
      </div>

      <div className="print:hidden max-w-7xl mx-auto px-4 pb-16 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="space-y-3">
          <ImportFlagsBanner
            flags={quote.importFlags}
            onDismiss={() => setQuote((q) => ({ ...q, importFlags: undefined }))}
          />
          <AddElementBar onAdd={addElement} elementTypes={elementTypes} categoryOrder={categoryOrder} />
          <ProjectGeometryPanel
            items={items}
            rates={rates}
            estimateGeometry={quote.estimateGeometry}
            onChangeItem={updateItem}
          />
          {items.map((item) => (
            <ElementCard
              key={item.id}
              item={item}
              rates={rates}
              onChange={(next) => updateItem(item.id, next)}
              onRemove={() => removeItem(item.id)}
              onDuplicate={() => duplicateItem(item.id)}
              onLabourRateChange={setLabourRate}
              onMaterialRateChange={setMaterialRate}
            />
          ))}
          {items.length === 0 && (
            <div className="text-center py-16 text-neutral-400 border-2 border-dashed border-neutral-200 rounded-xl">
              Pick an element above to add it — every applicable material, reo, formwork and labour line for that
              element type rolls down here, exactly like the estimating workbook.
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-20">
          <QuoteSummary
            items={items}
            onReorder={reorderItems}
            rates={rates}
            categoryOrder={categoryOrder}
            sectionOrder={sectionOrder}
            gfa={quote.gfa}
            setGfa={(v) => setQuote((q) => ({ ...q, gfa: v }))}
            overheadPct={quote.overheadPct}
            setOverheadPct={(v) => setQuote((q) => ({ ...q, overheadPct: v }))}
            contingencyPct={quote.contingencyPct}
            setContingencyPct={(v) => setQuote((q) => ({ ...q, contingencyPct: v }))}
          />
        </div>
      </div>

      <PrintQuoteReport
        quote={quote}
        items={items}
        rates={rates}
        categoryOrder={categoryOrder}
        sectionOrder={sectionOrder}
        visible={printPreviewOpen}
        onClose={() => setPrintPreviewOpen(false)}
        isPrintTarget={printTarget === "internal"}
      />

      <ExternalQuoteReport
        quote={quote}
        items={items}
        rates={rates}
        visible={externalQuoteOpen}
        onClose={() => setExternalQuoteOpen(false)}
        onChange={(externalQuote) => setQuote((q) => ({ ...q, externalQuote }))}
        isPrintTarget={printTarget === "external"}
      />

      <TenderQuoteReport
        quote={quote}
        items={items}
        rates={rates}
        visible={tenderQuoteOpen}
        onClose={() => setTenderQuoteOpen(false)}
        onChange={(tenderQuote) => setQuote((q) => ({ ...q, tenderQuote }))}
        isPrintTarget={printTarget === "tender"}
      />

      {exportCsv && (
        <ExportExcelModal
          filename={exportCsv.filename}
          html={exportCsv.html}
          plainText={exportCsv.plainText}
          onClose={() => setExportCsv(null)}
        />
      )}

      {ratesOpen && <RatesModal rates={rates} setRates={setRates} onClose={() => setRatesOpen(false)} />}
      {elementTypesOpen && (
        <ManageElementTypesModal customTypes={customTypes} setCustomTypes={setCustomTypes} onClose={() => setElementTypesOpen(false)} />
      )}
    </div>
  );
}
