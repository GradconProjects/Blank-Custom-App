import { useState, useMemo, useEffect, useRef } from "react";
import { Settings2, ArrowLeft, Printer, ListPlus, FileSpreadsheet, LayoutDashboard, Radar, FolderOpen, History, HardDriveDownload, AlertTriangle } from "lucide-react";
import { saveVersion, downloadQuoteFile, parseQuoteFile } from "./lib/quoteVersions.js";
import { quoteStorageKey } from "./lib/projects.js";
import VersionsModal from "./components/VersionsModal.jsx";
import { ELEMENT_TYPES, QUOTE_STATUSES, QUOTE_STATUS_STYLES } from "./data/catalog.js";
import { defaultRates, newElementItem, computeGrandTotal, uid, money, rateKey } from "./lib/costing.js";
import { pendingRateUpdates, readLibraryState, readLastSynced, writeLastSynced, RATES_LIBRARY_KEY } from "./lib/ratesLibrarySync.js";
import { buildQuoteExcelHtml, quoteExcelFilename, buildQuoteCsv } from "./lib/exportQuote.js";
import { useStoredState } from "./lib/storage.js";
import { PROJECTS_INDEX_KEY, newProjectEntry, migrateLegacyQuote, deleteQuote, writeQuote, readQuotes, publishQuoteToCostPlanner, mirrorQuoteSummary } from "./lib/projects.js";
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

const OFFICE_COMMS_KEY = "boma-office-communications";
const INITIAL_VIEW_KEY = "boma-quotes-initial-view";

export const CUSTOM_ELEMENT_TYPES_KEY = "boma-custom-element-types";
// Per-browser only (never synced) — which project's editor a plain page refresh
// should land back on, deliberately not shared across devices/users (someone
// else refreshing shouldn't get yanked into whatever project THIS browser had
// open).
const ACTIVE_PROJECT_KEY = "boma-active-project";

// New-project overheads/contingency seed from the portal Settings modal's
// stored preferences (entered there as whole %, stored under
// "boma-preferences"), falling back to the historical 8%/5%. Only NEW
// projects read this — existing quotes keep whatever they were saved with.
const prefPct = (key, fallback) => {
  try {
    const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
    return Number.isFinite(p[key]) ? p[key] / 100 : fallback;
  } catch {
    return fallback;
  }
};

/* Portal Settings → how versions are kept (see lib/quoteVersions.js). Read
 * at mount: the shell reloads this iframe after Settings are saved. */
const prefAutosaveMinutes = () => {
  try {
    const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
    return Number.isFinite(p.quotesAutosaveMinutes) && p.quotesAutosaveMinutes >= 0 ? p.quotesAutosaveMinutes : 10;
  } catch {
    return 10;
  }
};
const prefDownloadOnSave = () => {
  try {
    const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
    return p.quotesDownloadOnSave === true;
  } catch {
    return false;
  }
};

const prefStatus = () => {
  try {
    const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
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
  // Both cache-first (see storage.js): the index and the rates paint from the
  // last-known copy immediately and reconcile against the database behind.
  // "syncing" means exactly that — a value is showing but not yet confirmed
  // — and the one-off migrations below wait for "saved" (see `settled`).
  const [projects, setProjects, projectsStatus, saveProjectsNow] = useStoredState(PROJECTS_INDEX_KEY, [], { cacheFirst: true });
  const initialRates = useMemo(() => defaultRates(), []);
  const [rates, setRates, ratesStatus] = useStoredState("boma-rates", initialRates, { cacheFirst: true });
  const settled = (status) => status !== "loading" && status !== "syncing";
  const [initialView] = useState(takeInitialView);
  const [activeId, setActiveId] = useState(() => {
    // A pending Planner/Project Folder jump always wins over whatever project
    // this browser last had open — otherwise ProjectEditor would take over
    // and the tab bar (where Planner/Project Folder live) would never render.
    if (initialView) return null;
    try {
      // Portal Settings "reopen the last project" toggle — explicitly off
      // means every load lands on the Dashboard instead.
      const p = JSON.parse(localStorage.getItem("boma-preferences")) || {};
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
  /* Catalog price corrections, applied once to a stored rates blob.
   *
   * The Rates Library (portal/rates-library.html) is BOMA's real price
   * list and RULES: where the two disagreed, the catalog was wrong. Each
   * entry is [key, the old seeded figure, the Rates Library figure]. A stored
   * value still equal to the old seed was never touched by anyone, so it is
   * corrected; ANY other figure is a deliberate edit and is left alone.
   *
   * This runs because a browser persists the WHOLE seeded rates object the
   * first time it saves — without it, a corrected catalog price never reaches
   * an install that has been used (see the drift banner in RatesModal, which
   * catches the same problem for edits this table doesn't cover).
   *
   * NOTE: an earlier version of this effect ran the two formwork rows the
   * WRONG WAY (150 → 60 and 50 → 8), which is what made conventional formwork
   * price at well under half its real rate on the element cards while the
   * Rates Library showed $150. The direction is the whole point of the table.
   */
  useEffect(() => {
    if (!settled(ratesStatus)) return;
    const fixes = [
      [rateKey("FORMWORK", "Conventional", "m2"), 60, 150],
      [rateKey("FORMWORK", "Edgeform", "m"), 8, 50],
      [rateKey("CONCRETE", "15 mpa", "m3"), 196.5, 197],
      [rateKey("CONCRETE", "20 mpa", "m3"), 207.5, 199],
      [rateKey("CONCRETE", "25 mpa", "m3"), 212.5, 204],
      [rateKey("CONCRETE", "32 mpa", "m3"), 221.5, 213],
      [rateKey("CONCRETE", "40 mpa", "m3"), 233.5, 225],
      [rateKey("CONCRETE", "50 mpa", "m3"), 252.5, 264.2],
      [rateKey("CONCRETE", "25 mpa Agilia", "m3"), 310.5, 318],
      [rateKey("CONCRETE", "32 mpa Agilia", "m3"), 322.5, 317],
      [rateKey("CONCRETE", "40 mpa Agilia", "m3"), 334.5, 339],
      [rateKey("CONCRETE", "40 mpa Agilia (walls)", "m3"), 342.5, 339],
      [rateKey("REINFORCING ACCESSORIES", "CP 25/40 Bar chairs", "bag"), 16.2, 17.4],
      [rateKey("REINFORCING ACCESSORIES", "CP 50/65 Bar chairs", "bag"), 17.4, 18],
      [rateKey("REINFORCING ACCESSORIES", "CP 75/90 Bar chairs", "bag"), 21, 22.2],
      [rateKey("REINFORCING ACCESSORIES", "CP 85/100 Bar chairs", "bag"), 24, 25.2],
      [rateKey("REINFORCING ACCESSORIES", "BCPT 30 Bar chairs", "bag"), 19.2, 20.4],
      [rateKey("REINFORCING ACCESSORIES", "BCPT 100 Bar chairs", "bag"), 45.6, 48],
      [rateKey("REINFORCING ACCESSORIES", "Base 152", "bag"), 36.6, 38.4],
      [rateKey("REINFORCING ACCESSORIES", "BP1.6 Tie wire", "roll"), 5.15, 4.8],
      [rateKey("REINFORCING ACCESSORIES", "Duct Tape", "roll"), 4.5, 4.2],
    ];
    const stale = fixes.filter(([key, oldSeed]) => rates[key] && rates[key].unitCost === oldSeed);
    if (stale.length) {
      const next = { ...rates };
      stale.forEach(([key, , now]) => { next[key] = { ...next[key], unitCost: now }; });
      setRates(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratesStatus]);

  /* Follow the Rates Library. It is BOMA's authoritative price list, and
   * Cost Planner and Estimates already read it live — Quotes kept its own
   * copy, so editing a library price changed nothing on an element card.
   *
   * A rate still at its catalog default, or still at whatever this sync last
   * wrote, belongs to the library and takes its price. Anything an estimator
   * typed in the Rates modal is left alone (the modal's drift banner shows it
   * and offers a restore). Runs on load and on the storage event the library
   * fires when it saves, the same signal Cost Planner listens for. */
  useEffect(() => {
    if (!settled(ratesStatus)) return;
    const apply = () => {
      const updates = pendingRateUpdates(rates, readLibraryState(), readLastSynced());
      if (!updates.length) return;                 // nothing to do — never loops
      const next = { ...rates };
      const synced = { ...readLastSynced() };
      updates.forEach(({ key, price }) => {
        next[key] = { ...(next[key] || {}), unitCost: price };
        synced[key] = price;
      });
      writeLastSynced(synced);
      setRates(next);
    };
    apply();
    const onStorage = (e) => { if (!e || e.key === RATES_LIBRARY_KEY) apply(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratesStatus, rates]);
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
  // fixed "boma-quote" key before multi-project support existed.
  useEffect(() => {
    if (!settled(projectsStatus)) return;
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
    if (!settled(projectsStatus)) return;

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

  // A new project is a DRAFT until it has a name or an element: it lives
  // only in this state, not in the persisted index, so an "Untitled project"
  // that was opened and abandoned never appears on anyone's dashboard. The
  // editor promotes it (onPromote) the moment it earns a place; leaving it
  // unpromoted discards it, data row included.
  const [draft, setDraft] = useState(null);
  const activeProject = projects.find((p) => p.id === activeId) || (draft && draft.id === activeId ? draft : null);
  const activeIsDraft = !!activeProject && !projects.some((p) => p.id === activeProject.id);

  const createProject = () => {
    const entry = newProjectEntry();
    setDraft(entry);
    setActiveId(entry.id);
  };
  const promoteDraft = () => {
    if (!draft) return;
    const d = draft;
    setProjects((ps) => (ps.some((p) => p.id === d.id) ? ps : [...ps, d]));
    setDraft(null);
  };
  const leaveProject = () => {
    if (draft && activeId === draft.id) {
      deleteQuote(draft.storageKey);      // may not exist — harmless
      setDraft(null);
    }
    setActiveId(null);
  };
  // Dashboard found index entries with no data row (see its comment).
  const pruneProjects = (ids) => setProjects((ps) => ps.filter((p) => !ids.includes(p.id)));

  // "Open .json": a file written by Save-to-computer or a Versions download
  // becomes a project. Its row is written BEFORE it joins the index, so the
  // index can never point at a row that isn't there. A file whose project
  // already exists here opens as a separate copy rather than overwriting —
  // restoring INTO an existing project is what its Versions list is for.
  const importQuoteFile = async (text, fileName) => {
    let parsed;
    try {
      parsed = parseQuoteFile(text);
    } catch (e) {
      alert(`Couldn't open ${fileName || "that file"}: ${e.message}`);
      return;
    }
    const exists = parsed.projectId && projects.some((p) => p.id === parsed.projectId);
    const entry = parsed.projectId && !exists
      ? { id: parsed.projectId, storageKey: quoteStorageKey(parsed.projectId), createdAt: new Date().toISOString() }
      : newProjectEntry();
    const quote = exists
      ? { ...parsed.quote, projectName: `${parsed.quote.projectName || "Untitled project"} (from file)` }
      : parsed.quote;
    await writeQuote(entry.storageKey, quote);
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
              BOMA ESTIMATES
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
                disabled={ratesStatus === "loading"}
                title={ratesStatus === "loading" ? "Loading the rates…" : undefined}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                <Settings2 size={16} /> Rates
              </button>
            </div>
          </div>
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 border-t border-blue-900/60">
            {[
              { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
              { key: "planner", label: "Project Management", Icon: Radar },
              { key: "folder", label: "Project Vault", Icon: FolderOpen },
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
          <Dashboard projects={projects} rates={rates} onOpen={setActiveId} onCreate={createProject} onDelete={deleteProject} onImportFile={importQuoteFile} onPrune={pruneProjects} />
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
      onBack={leaveProject}
      isDraft={activeIsDraft}
      onPromote={promoteDraft}
      elementTypes={allElementTypes}
      categoryOrder={allCategoryOrder}
      sectionOrder={allSectionOrder}
      customTypes={customTypes}
      setCustomTypes={setCustomTypes}
    />
  );
}

function ProjectEditor({ project, rates, setRates, ratesStatus, saveProjectsNow, onBack, isDraft, onPromote, elementTypes, categoryOrder, sectionOrder, customTypes, setCustomTypes }) {
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

  // Keeps the dashboard's instant-paint summary of this project current with
  // every edit (name, client, status, deadline, quantities), so the next visit
  // never flashes a stale row. Only once the real row has loaded — the blank
  // placeholder quote held during the load must never be mirrored.
  useEffect(() => {
    if (quoteStatus === "loading") return;
    const t = setTimeout(() => { mirrorQuoteSummary(project.storageKey, quote); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.storageKey, quote, quoteStatus]);

  // A draft earns its place in the index the moment it has a name or an
  // element (see App's draft state). Never while its row is still loading.
  useEffect(() => {
    if (!isDraft || quoteStatus === "loading") return;
    if ((quote.projectName || "").trim() || (quote.items || []).length > 0) onPromote();
  }, [isDraft, quoteStatus, quote.projectName, quote.items, onPromote]);

  /* ---- Versions: unlimited saves, autosaved on an interval, optional local copy ---- */
  const [autosaveMinutes] = useState(prefAutosaveMinutes);
  const [downloadOnSave] = useState(prefDownloadOnSave);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [saveNote, setSaveNote] = useState(null);           // { text, tone: "ok" | "error" }
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  const changedSinceVersionRef = useRef(false);            // anything to autosave?
  const seenLoadedQuoteRef = useRef(false);
  useEffect(() => {
    if (quoteStatus === "loading") return;
    // The first settled value is the row arriving, not an edit — opening a
    // project must not by itself produce an autosave version.
    if (!seenLoadedQuoteRef.current) { seenLoadedQuoteRef.current = true; return; }
    changedSinceVersionRef.current = true;
  }, [quote, quoteStatus]);
  const note = (text, tone = "ok") => {
    setSaveNote({ text, tone });
    setTimeout(() => setSaveNote((cur) => (cur && cur.text === text ? null : cur)), tone === "ok" ? 4000 : 12000);
  };
  const keepVersion = async (source) => {
    const v = await saveVersion(project.id, quoteRef.current, source);
    changedSinceVersionRef.current = false;
    return v;
  };
  // Save = the live row now + the index + Cost Planner (as before), PLUS a
  // version kept for good, PLUS a copy on this computer when Settings say so.
  const handleSave = async () => {
    saveQuoteNow();
    saveProjectsNow();
    publishQuoteToCostPlanner(project.id, quote);
    if (isDraft) onPromote();
    try {
      await keepVersion("manual");
      note(`Saved — version kept ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (e) {
      note(e?.code === "VERSIONS_UNAVAILABLE" ? e.message : `Saved, but the version could not be kept: ${e?.message || e}`, "error");
    }
    if (downloadOnSave) {
      try { await downloadQuoteFile(project.id, quoteRef.current, "manual"); } catch (e) { note(`Couldn't save the copy to this computer: ${e?.message || e}`, "error"); }
    }
  };
  const handleSaveToComputer = async () => {
    saveQuoteNow();
    if (isDraft) onPromote();
    try {
      const how = await downloadQuoteFile(project.id, quoteRef.current, "manual");
      if (how === "cancelled") note("Save to computer cancelled");
      else note(how === "picker" ? "Saved to the folder you chose" : "Saved to this computer (check your Downloads folder)");
    } catch (e) {
      note(`Couldn't save to this computer: ${e?.message || e}`, "error");
    }
  };
  // Autosave: a version every N minutes while something has changed.
  useEffect(() => {
    if (!(autosaveMinutes > 0) || quoteStatus === "loading") return;
    const id = setInterval(async () => {
      if (!changedSinceVersionRef.current) return;
      try {
        await keepVersion("autosave");
        note(`Autosaved a version ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`);
      } catch { /* the next tick tries again; a manual Save reports failures */ }
    }, autosaveMinutes * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveMinutes, project.id, quoteStatus]);
  // Restore keeps what is on screen NOW as its own version first, so a
  // restore can be undone from the same list.
  const restoreVersion = async (restoredQuote) => {
    try { await keepVersion("before-restore"); } catch { /* still restore — the live row is the moving copy */ }
    setQuote({ ...restoredQuote });
    note("Version restored — what you had before is kept as a version too");
  };

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
    : quoteStatus === "loading" || ratesStatus === "loading" || ratesStatus === "syncing" ? "loading"
    : "saved";

  // Nothing editable until this project's own row has arrived. The hook
  // cannot save an edit made before it has loaded, and the arriving row
  // then replaces whatever was typed — so for the length of one round trip
  // a keystroke here was silently lost. Worse for an EXISTING project: the
  // screen showed a blank quote for that moment, and an edit made against
  // it would have been saved as the whole quote. A brief blank (same as the
  // dashboard's own gate) is the only safe state to show.
  if (quoteStatus === "loading") {
    return <div className="min-h-screen bg-neutral-100" />;
  }

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
            <div className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold">BOMA ESTIMATES</div>
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
            title="BOMA's own cost/material/labour breakdown, for internal use"
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
            title="The full tender quotation document — BOMA's real quotation layout, every line item and section editable, seeded from this quote and its estimating quantities, with a print preview. Never includes markup drawings."
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
            disabled={ratesStatus === "loading"}
            title={ratesStatus === "loading" ? "Loading the rates…" : undefined}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium transition-colors flex-none"
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
          {saveNote && (
            <span className={`text-xs font-medium ${saveNote.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{saveNote.text}</span>
          )}
          <SaveBadge status={overallStatus} />
          <button
            type="button"
            onClick={() => setVersionsOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            title="Every saved version of this quote — restore or download any of them"
          >
            <History size={14} /> Versions
          </button>
          <button
            type="button"
            onClick={handleSaveToComputer}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            title="Save this quote as a file on this computer (opens a Save-as dialog where the browser allows it, otherwise goes to Downloads)"
          >
            <HardDriveDownload size={14} /> Save to computer
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-orange-600 text-white hover:bg-orange-700"
            title="Save now: the live quote, its place on the Dashboard, Cost Planner's BOQ — and keep a version of it for good"
          >
            Save
          </button>
        </div>
      </div>
      {overallStatus === "error" && (
        <div className="print:hidden max-w-7xl mx-auto px-4 pb-3">
          <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm px-4 py-3">
            <AlertTriangle size={18} className="flex-none mt-0.5" />
            <div>
              <b>Your changes are not reaching the cloud.</b> They are safe in this tab and the app keeps retrying on its own — but do not close this tab
              until the badge says <b>Saved</b>. To be sure, click <b>Save to computer</b> now and keep the file.
            </div>
          </div>
        </div>
      )}
      {versionsOpen && (
        <VersionsModal
          projectId={project.id}
          projectName={quote.projectName}
          autosaveMinutes={autosaveMinutes}
          onRestore={restoreVersion}
          onClose={() => setVersionsOpen(false)}
        />
      )}

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
            assumptions={quote.assumptions}
            onChangeAssumptions={(assumptions) => setQuote((q) => ({ ...q, assumptions }))}
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
