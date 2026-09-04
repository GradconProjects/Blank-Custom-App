import { useState, useMemo, useEffect } from "react";
import { Settings2, ArrowLeft, Printer, ListPlus, FileSpreadsheet } from "lucide-react";
import { ELEMENT_TYPES } from "./data/catalog.js";
import { defaultRates, newElementItem, computeGrandTotal, uid, money } from "./lib/costing.js";
import { buildQuoteExcelHtml, quoteExcelFilename, buildQuoteCsv } from "./lib/exportQuote.js";
import { useStoredState } from "./lib/storage.js";
import { PROJECTS_INDEX_KEY, newProjectEntry, migrateLegacyQuote, deleteQuote, writeQuote } from "./lib/projects.js";
import { ESTIMATE_EXPORT_KEY, buildImportFromEstimate } from "./lib/estimateImport.js";
import { SaveBadge } from "./components/atoms.jsx";
import AddElementBar from "./components/AddElementBar.jsx";
import ElementCard from "./components/ElementCard.jsx";
import QuoteSummary from "./components/QuoteSummary.jsx";
import RatesModal from "./components/RatesModal.jsx";
import Dashboard from "./components/Dashboard.jsx";
import PrintQuoteReport from "./components/PrintQuoteReport.jsx";
import ExportExcelModal from "./components/ExportExcelModal.jsx";
import ImportFlagsBanner from "./components/ImportFlagsBanner.jsx";
import ManageElementTypesModal from "./components/ManageElementTypesModal.jsx";

export const CUSTOM_ELEMENT_TYPES_KEY = "boma-custom-element-types";

const blankQuote = () => ({
  projectName: "",
  projectDate: new Date().toISOString().slice(0, 10),
  gfa: undefined,
  overheadPct: 0.08,
  contingencyPct: 0.05,
  items: [],
});

export default function App() {
  const [projects, setProjects, projectsStatus] = useStoredState(PROJECTS_INDEX_KEY, []);
  const initialRates = useMemo(() => defaultRates(), []);
  const [rates, setRates, ratesStatus] = useStoredState("boma-rates", initialRates);
  const [activeId, setActiveId] = useState(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [elementTypesOpen, setElementTypesOpen] = useState(false);

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
  // under ESTIMATE_EXPORT_KEY and switches the portal over to this app —
  // this effect is what actually turns that into a new project.
  useEffect(() => {
    if (projectsStatus === "loading") return;
    let raw;
    try {
      raw = window.localStorage.getItem(ESTIMATE_EXPORT_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    (async () => {
      try {
        const estimateExport = JSON.parse(raw);
        const { quote } = buildImportFromEstimate(estimateExport);
        const entry = newProjectEntry();
        await writeQuote(entry.storageKey, quote);
        setProjects((ps) => [...ps, entry]);
        setActiveId(entry.id);
      } finally {
        try { window.localStorage.removeItem(ESTIMATE_EXPORT_KEY); } catch { /* best-effort */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsStatus]);

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
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors"
              >
                <Settings2 size={16} /> Rates
              </button>
            </div>
          </div>
        </div>
        <Dashboard projects={projects} rates={rates} onOpen={setActiveId} onCreate={createProject} onDelete={deleteProject} />
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
      onBack={() => setActiveId(null)}
      elementTypes={allElementTypes}
      categoryOrder={allCategoryOrder}
      sectionOrder={allSectionOrder}
      customTypes={customTypes}
      setCustomTypes={setCustomTypes}
    />
  );
}

function ProjectEditor({ project, rates, setRates, ratesStatus, onBack, elementTypes, categoryOrder, sectionOrder, customTypes, setCustomTypes }) {
  const [quote, setQuote, quoteStatus] = useStoredState(project.storageKey, blankQuote());
  const [ratesOpen, setRatesOpen] = useState(false);
  const [elementTypesOpen, setElementTypesOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
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
            <div className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold">BOMA ESTIMATES</div>
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
              // window.print() can be silently blocked (no-op, no throw) when
              // this app is embedded in a sandboxed iframe — try it, but
              // always also open the on-screen preview so there's a working
              // fallback regardless of whether the native dialog opened.
              try { window.print(); } catch (e) { /* fall through to preview */ }
              setPrintPreviewOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-sm font-medium transition-colors flex-none"
            title="Print or save as PDF"
          >
            <Printer size={16} /> Print / PDF
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
        </div>
        <SaveBadge status={overallStatus} />
      </div>

      <div className="print:hidden max-w-7xl mx-auto px-4 pb-16 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="space-y-3">
          <ImportFlagsBanner
            flags={quote.importFlags}
            onDismiss={() => setQuote((q) => ({ ...q, importFlags: undefined }))}
          />
          <AddElementBar onAdd={addElement} elementTypes={elementTypes} categoryOrder={categoryOrder} />
          {items.map((item) => (
            <ElementCard
              key={item.id}
              item={item}
              rates={rates}
              onChange={(next) => updateItem(item.id, next)}
              onRemove={() => removeItem(item.id)}
              onDuplicate={() => duplicateItem(item.id)}
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
