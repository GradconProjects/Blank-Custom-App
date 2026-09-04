import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Copy, Trash2, Paperclip, X, RotateCw, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { FULL_CATALOG, LABOUR_TEMPLATES } from "../data/catalog.js";
import { uid, money2, computeElementCost, computeElementUnitRates, autoLabourQtys, labourQuantities } from "../lib/costing.js";
import { pdfToJpegPages } from "../lib/pdfToImages.js";
import CategoryBlock from "./CategoryBlock.jsx";
import LabourMatrix from "./LabourMatrix.jsx";
import AdditionalItems from "./AdditionalItems.jsx";

export default function ElementCard({ item, rates, onChange, onRemove, onDuplicate, onLabourRateChange, onMaterialRateChange }) {
  // Every material category starts collapsed — only Labour/Equipment starts
  // expanded (it's still collapsible too, just defaults open).
  const [openCats, setOpenCats] = useState({});
  // Everything starts ROLLED UP: the labour matrix and the whole card, same
  // as every material category. The Settings toggle can restore open-by-
  // default cards by being explicitly set to false.
  const [labourOpen, setLabourOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem("gradcon-preferences")) || {};
      return p.quotesCardsCollapsed === false;
    } catch {
      return false;
    }
  });

  const cost = useMemo(() => computeElementCost(item, rates), [item, rates]);
  // Benchmark rates for the panel beside this row — $/lm and $/m² over the
  // geometry measured in Estimates, $/m³ over this element's own concrete.
  const unitRates = useMemo(() => computeElementUnitRates(item, rates), [item, rates]);

  const patch = (fn) => onChange(fn(item));

  // Seamless labour: with auto on (the default), crew days are DERIVED live
  // inside computeElementCost from the quantities entered, at the rates
  // library's production rates — nothing is written into the tasks, so the
  // labour keeps tracking every quantity change. (The old approach wrote the
  // suggestion in once, which went stale the moment a quantity changed.)
  // A typed cell always wins; clearing it hands the cell back to the engine.
  // Elements created before the crew sheet carry the old per-type task rows
  // (formwork / setout / blinding etc.). If NOTHING was ever entered on
  // them, swap the rows for the crew sheet once — entered data is never
  // touched (those elements keep their rows; delete any by hand).
  useEffect(() => {
    const legacy = item.tasks.some((t) => /formwork|setout|blinding|lay poly|cart spoil|backfill|factory/i.test(t.name));
    const untouched = item.tasks.every((t) => Object.keys(t.qtys || {}).length === 0 && (t.qty === undefined || t.qty === "") && !t.notes);
    if (legacy && untouched) {
      patch((it) => ({ ...it, tasks: LABOUR_TEMPLATES.footing.map((name) => ({ id: uid(), name, qtys: {} })) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time crew-engine migration (labourVer 2): elements saved before the
  // whole-crew engine carry cell values the OLD prefill wrote directly into
  // the tasks (e.g. 1 steel-crew day against 2.99 t). Filled cells always
  // beat the engine, so those stale figures would shadow the correct
  // whole-crew numbers forever — including after an Estimates publish
  // updates the element's quantities. With auto on, clear them once and let
  // the live engine drive; an element the estimator set to manual keeps its
  // figures untouched. New elements are born at ver 2, and any cell typed
  // AFTER this runs is a genuine override and survives normally.
  useEffect(() => {
    if (item.labourVer === 2) return;
    patch((it) => {
      if (it.labourVer === 2) return it;
      const auto = it.labourAuto !== false;
      return {
        ...it,
        labourVer: 2,
        tasks: auto ? it.tasks.map((t) => ({ ...t, qtys: {}, qty: undefined })) : it.tasks,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labourAuto = item.labourAuto !== false;
  const autoQtys = useMemo(
    () => (labourAuto ? autoLabourQtys(item, rates) : null),
    [labourAuto, item, rates]
  );
  // The quantities each crew-sheet row draws on, for the Qty column display.
  const labourQtyCtx = useMemo(() => labourQuantities(item, rates), [item, rates]);
  const toggleLabourAuto = () =>
    patch((it) => {
      if (it.labourAuto !== false) {
        // Turning auto OFF freezes the current derived numbers into the
        // matrix so they can be hand-edited from where they stand.
        const auto = autoLabourQtys(it, rates);
        return {
          ...it,
          labourAuto: false,
          tasks: it.tasks.map((t) => (auto[t.id] ? { ...t, qtys: { ...auto[t.id], ...t.qtys } } : t)),
        };
      }
      return { ...it, labourAuto: true };
    });
  // Wipes every typed Qty/crew cell (and any values baked in by the old
  // write-in prefill engine) and hands the whole sheet back to the live
  // crew-day engine — the fix for stale figures like a pour row still
  // carrying days derived from a long-changed concrete quantity.
  const resetLabourAuto = () =>
    patch((it) => ({
      ...it,
      labourAuto: true,
      tasks: it.tasks.map((t) => ({ ...t, qtys: {}, qty: undefined })),
    }));

  const setQty = (qKey, v) => patch((it) => ({ ...it, qtys: { ...it.qtys, [qKey]: v } }));
  const setLabel = (v) => patch((it) => ({ ...it, label: v }));
  const addTask = () => patch((it) => ({ ...it, tasks: [...it.tasks, { id: uid(), name: "New task", qtys: {} }] }));
  const removeTask = (taskId) => patch((it) => ({ ...it, tasks: it.tasks.filter((t) => t.id !== taskId) }));
  const renameTask = (taskId, name) => patch((it) => ({ ...it, tasks: it.tasks.map((t) => (t.id === taskId ? { ...t, name } : t)) }));
  const setTaskQty = (taskId, resKey, v) =>
    patch((it) => ({ ...it, tasks: it.tasks.map((t) => (t.id === taskId ? { ...t, qtys: { ...t.qtys, [resKey]: v } } : t)) }));
  // Row Qty override and Notes on the crew sheet
  const setTaskMeta = (taskId, field, v) =>
    patch((it) => ({ ...it, tasks: it.tasks.map((t) => (t.id === taskId ? { ...t, [field]: v } : t)) }));

  const addAdditional = () =>
    patch((it) => ({ ...it, additional: [...it.additional, { id: uid(), name: "", unit: "", qty: undefined, rate: undefined }] }));
  const removeAdditional = (id) => patch((it) => ({ ...it, additional: it.additional.filter((a) => a.id !== id) }));
  const changeAdditional = (id, field, v) =>
    patch((it) => ({ ...it, additional: it.additional.map((a) => (a.id === id ? { ...a, [field]: v } : a)) }));
  // Multi-field fill in one patch — used by the catalog picker, which sets
  // name+unit+rate together (three changeAdditional calls would each start
  // from the same stale `item` and drop each other's fields).
  const fillAdditional = (id, fields) =>
    patch((it) => ({ ...it, additional: it.additional.map((a) => (a.id === id ? { ...a, ...fields } : a)) }));

  const setDescription = (v) => patch((it) => ({ ...it, description: v }));
  // The description box is for SPECIALIST elements only — hidden by default
  // so ordinary line items stay compact. It appears when the estimator opens
  // it via the small "+ specification" toggle, and stays visible whenever the
  // item already carries text (so a saved description can't disappear).
  const [descOpen, setDescOpen] = useState(false);
  const showDesc = descOpen || !!(item.description && String(item.description).trim());

  // Markup drawings (pdf/png/jpg) stored as data URLs on the item itself so
  // they travel with the quote through localStorage/Supabase like everything
  // else. Capped per file — the whole quote has to fit in one storage blob.
  const MAX_MARKUP_BYTES = 3 * 1024 * 1024;
  const fileInputRef = useRef(null);
  const addMarkupFiles = (fileList) => {
    const files = Array.from(fileList || []);
    files.forEach((file) => {
      const ok = /\.(pdf|png|jpe?g)$/i.test(file.name) || /^(application\/pdf|image\/(png|jpeg))$/.test(file.type);
      if (!ok) {
        alert(`"${file.name}" isn't a PDF, PNG or JPG — not added.`);
        return;
      }
      if (file.size > MAX_MARKUP_BYTES) {
        alert(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — markups are capped at 3 MB each so the quote still saves. Export a smaller/flattened copy and try again.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (isPdf) {
          // PDFs convert to JPEG page images on the way in — every markup is
          // then a plain picture: rotates (and STAYS rotated — saved with the
          // quote), zooms in the lightbox, prints. The raw PDF is only kept
          // if the conversion itself fails.
          setConvertingPdf(true);
          try {
            const { pages, numPages } = await pdfToJpegPages(reader.result);
            const imgs = pages.map((p, i) => ({
              id: uid(),
              name: pages.length > 1 ? `${file.name} — page ${i + 1}` : file.name,
              type: "image",
              dataURL: p,
            }));
            patch((it) => ({ ...it, markups: [...(it.markups || []), ...imgs] }));
            if (numPages > pages.length) alert(`"${file.name}" has ${numPages} pages — the first ${pages.length} were added (markups are for the relevant sheets, not whole drawing sets).`);
          } catch (err) {
            patch((it) => ({
              ...it,
              markups: [...(it.markups || []), { id: uid(), name: file.name, type: "pdf", dataURL: reader.result }],
            }));
          } finally {
            setConvertingPdf(false);
          }
          return;
        }
        patch((it) => ({
          ...it,
          markups: [...(it.markups || []), { id: uid(), name: file.name, type: "image", dataURL: reader.result }],
        }));
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const removeMarkup = (id) => patch((it) => ({ ...it, markups: (it.markups || []).filter((m) => m.id !== id) }));
  const [convertingPdf, setConvertingPdf] = useState(false);
  // A PDF markup attached before conversion existed can be upgraded in
  // place: its pages become image markups (zoom + persistent rotation).
  const convertPdfMarkup = async (id) => {
    const m = (item.markups || []).find((x) => x.id === id);
    if (!m || m.type !== "pdf") return;
    setConvertingPdf(true);
    try {
      const { pages } = await pdfToJpegPages(m.dataURL);
      const imgs = pages.map((p, i) => ({
        id: uid(),
        name: pages.length > 1 ? `${m.name} — page ${i + 1}` : m.name,
        type: "image",
        dataURL: p,
      }));
      patch((it) => ({ ...it, markups: (it.markups || []).flatMap((x) => (x.id === id ? imgs : [x])) }));
    } catch (err) {
      alert(`Couldn't render "${m.name}" to images — the PDF may be corrupt or password-protected.`);
    } finally {
      setConvertingPdf(false);
    }
  };
  // Rotation is stored ON the markup itself, so a plan uploaded sideways is
  // fixed once and stays fixed — every device, every reload, and the print
  // report all honour it.
  const rotateMarkup = (id) =>
    patch((it) => ({ ...it, markups: (it.markups || []).map((m) => (m.id === id ? { ...m, rotation: ((m.rotation || 0) + 90) % 360 } : m)) }));
  const markups = item.markups || [];
  // The drawings themselves must be easily seen, not hidden behind a click:
  // when an element HAS markups, the section opens with the card and every
  // drawing renders full-size inline. Only an element with no markups keeps
  // the section as a slim collapsed header.
  const [markupsOpen, setMarkupsOpen] = useState(() => (item.markups || []).length > 0);
  const [viewerId, setViewerId] = useState(null); // markup id open in the zoom lightbox
  const viewerMarkup = markups.find((m) => m.id === viewerId) || null;

  return (
    <div className="flex items-stretch gap-2">
    <div
      className={`rounded-xl border border-neutral-200 shadow-sm overflow-hidden flex-1 min-w-0 flex flex-col ${
        cardOpen ? "bg-white" : "bg-blue-950"
      }`}
    >
      <div className="bg-blue-950 text-white px-4 py-3 flex flex-1 items-center gap-3">
        <button onClick={() => setCardOpen(!cardOpen)} className="text-blue-300 hover:text-white transition-colors flex-none">
          {cardOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold flex items-center gap-1.5">
            <span>{item.category} {item.category && item.section ? "›" : ""} {item.section}</span>
            {markups.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-orange-400 normal-case tracking-normal" title={`${markups.length} markup drawing(s) attached`}>
                <Paperclip size={10} /> {markups.length}
              </span>
            )}
          </div>
          <input
            value={item.label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-transparent border-0 text-white font-semibold text-[15px] focus:outline-none focus:underline decoration-orange-400"
          />
        </div>
        <div className="text-right flex-none">
          <div className="text-[10px] uppercase tracking-widest text-blue-300">Total</div>
          <div className="font-mono tabular-nums text-lg font-bold text-orange-400">{money2(cost.total)}</div>
        </div>
        <button onClick={onDuplicate} title="Duplicate" className="text-blue-300 hover:text-white transition-colors flex-none">
          <Copy size={16} />
        </button>
        <button onClick={onRemove} title="Remove" className="text-blue-300 hover:text-red-400 transition-colors flex-none">
          <Trash2 size={16} />
        </button>
      </div>

      {cardOpen && (
        <div className="p-3 space-y-2 bg-neutral-50">
          <div className="text-xs text-neutral-500 flex flex-wrap gap-x-4 gap-y-1 px-1">
            <span>Concrete qty: <b className="font-mono text-neutral-700">{cost.concreteQty.toFixed(2)} m³</b></span>
            <span>Materials: <b className="font-mono text-neutral-700">{money2(cost.materialsTotal)}</b></span>
            <span>Labour/Equipment: <b className="font-mono text-neutral-700">{money2(cost.labourTotal)}</b></span>
            <span>Custom items: <b className="font-mono text-neutral-700">{money2(cost.additionalTotal)}</b></span>
          </div>

          {showDesc ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
                  Specialist element — description / specification
                </div>
                <button
                  onClick={() => { setDescription(""); setDescOpen(false); }}
                  className="text-[11px] text-neutral-400 hover:text-red-500"
                  title="Remove the description from this element"
                >
                  remove
                </button>
              </div>
              <textarea
                value={item.description || ""}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                autoFocus={descOpen && !(item.description && String(item.description).trim())}
                placeholder="Spell out the specialist spec: e.g. type of insulation (Kooltherm K3 60mm R2.70 under slab), finish, concrete class notes, inclusions/exclusions…"
                className="w-full text-[13px] border border-neutral-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-orange-400 resize-y"
              />
            </div>
          ) : (
            <button
              onClick={() => setDescOpen(true)}
              className="text-[11px] font-medium text-neutral-400 hover:text-orange-600 px-1 self-start text-left"
            >
              + Add specification / description (specialist elements)
            </button>
          )}

          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => setMarkupsOpen(!markupsOpen)}
                className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold flex items-center gap-1.5"
              >
                {markupsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Paperclip size={12} /> Markup drawings {markups.length > 0 && <span className="text-orange-600">({markups.length})</span>}
              </button>
              <label className="cursor-pointer px-2.5 py-1 rounded-md bg-blue-950 hover:bg-blue-900 text-white text-[11px] font-semibold">
                Upload PDF / PNG / JPG
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  multiple
                  className="hidden"
                  onChange={(e) => { addMarkupFiles(e.target.files); setMarkupsOpen(true); }}
                />
              </label>
            </div>
            {markupsOpen && (
              <div className="px-3 pb-3">
                {markups.length === 0 ? (
                  <div className="text-[12px] text-neutral-400 italic">
                    No markups attached — upload the marked-up drawing(s) this line item was measured from.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {markups.map((m) => (
                      <div key={m.id} className="border border-neutral-200 rounded-md overflow-hidden bg-neutral-50">
                        <div className="flex items-center justify-between gap-2 px-2 py-1 bg-neutral-100 text-[11px]">
                          <span className="truncate font-medium text-neutral-700" title={m.name}>{m.name}</span>
                          <div className="flex items-center gap-1.5 flex-none">
                            {m.type === "image" && (
                              <button
                                onClick={() => rotateMarkup(m.id)}
                                title="Rotate 90° — saved with the quote, stays rotated everywhere"
                                className="text-neutral-400 hover:text-blue-700 transition-colors"
                              >
                                <RotateCw size={14} />
                              </button>
                            )}
                            {m.type === "pdf" && (
                              <button
                                onClick={() => convertPdfMarkup(m.id)}
                                disabled={convertingPdf}
                                title="Convert this PDF's pages to images — readable, zoomable, rotatable (rotation saves with the quote)"
                                className="text-[10px] font-semibold text-orange-700 border border-orange-300 rounded px-1.5 py-0.5 hover:bg-orange-50 transition-colors"
                              >
                                {convertingPdf ? "Converting…" : "→ Images"}
                              </button>
                            )}
                            <button
                              onClick={() => setViewerId(m.id)}
                              title="Full screen — zoom with scroll or buttons, drag to pan"
                              className="text-neutral-400 hover:text-blue-700 transition-colors"
                            >
                              <ZoomIn size={14} />
                            </button>
                            <button
                              onClick={() => removeMarkup(m.id)}
                              title="Remove markup"
                              className="text-neutral-400 hover:text-red-500 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                        {/* the drawing itself, full size in the card — click it for the zoom viewer */}
                        {m.type === "pdf" ? (
                          <embed src={m.dataURL} type="application/pdf" className="w-full h-[32rem] bg-neutral-100" />
                        ) : (
                          <div
                            onClick={() => setViewerId(m.id)}
                            title="Click to zoom"
                            className="w-full flex items-center justify-center overflow-hidden cursor-zoom-in bg-white"
                          >
                            <img
                              src={m.dataURL}
                              alt={m.name}
                              className="max-w-full object-contain"
                              style={{
                                transform: `rotate(${m.rotation || 0}deg)`,
                                // bound BOTH axes when rotated sideways so the turned image
                                // can't spill out of the card
                                maxHeight: (m.rotation || 0) % 180 !== 0 ? "28rem" : "32rem",
                                maxWidth: (m.rotation || 0) % 180 !== 0 ? "28rem" : "100%",
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {FULL_CATALOG.map((cat) => (
            <CategoryBlock
              key={cat.key}
              cat={cat}
              item={item}
              rates={rates}
              onQtyChange={setQty}
              onRateChange={onMaterialRateChange}
              catOpen={openCats[cat.key]}
              toggleCat={() => setOpenCats((o) => ({ ...o, [cat.key]: !o[cat.key] }))}
              catTotal={cost.categoryTotals[cat.key]}
            />
          ))}

          <LabourMatrix
            labourAuto={labourAuto}
            autoQtys={autoQtys}
            onToggleAuto={toggleLabourAuto}
            onResetAuto={resetLabourAuto}
            labourQtyCtx={labourQtyCtx}
            onTaskMetaChange={setTaskMeta}
            onLabourRateChange={onLabourRateChange}
            item={item}
            rates={rates}
            onTaskQtyChange={setTaskQty}
            onAddTask={addTask}
            onRemoveTask={removeTask}
            onRenameTask={renameTask}
            resourceTotals={cost.resourceTotals}
            resourceCosts={cost.resourceCosts}
            labourTotal={cost.labourTotal}
            labourOpen={labourOpen}
            toggleLabour={() => setLabourOpen((o) => !o)}
          />

          <AdditionalItems
            item={item}
            rates={rates}
            onAdd={addAdditional}
            onRemove={removeAdditional}
            onChange={changeAdditional}
            onFill={fillAdditional}
            total={cost.additionalTotal}
          />
        </div>
      )}

      {viewerMarkup && (
        <MarkupLightbox
          markup={viewerMarkup}
          onClose={() => setViewerId(null)}
          onRotate={() => rotateMarkup(viewerMarkup.id)}
        />
      )}
    </div>

    {/* Folded, the panel stretches to the row's exact height so the two line
        up; expanded, it must NOT grow with the opened card — it stays at its
        own natural height beside the row's header. */}
    {unitRates.length > 0 && (
      <div
        className={`hidden md:flex w-56 flex-none rounded-xl border border-amber-900 bg-amber-900 shadow-sm flex-col justify-center gap-1 px-3 py-2 ${cardOpen ? "self-start" : "self-stretch"}`}
        title="Benchmark unit rates: this element's WHOLE cost (concrete + reinforcement + formwork + labour/plant + custom items) divided by each measure beside it. Lengths and areas come from the Project Geometry table below (auto-filled from the Estimates takeoff, editable there); the m³ is this element's own poured concrete volume."
      >
        {unitRates.map((u) => (
          <div key={u.unit} className="font-mono tabular-nums whitespace-nowrap leading-5">
            <span className="text-[15px] font-bold text-orange-300">{money2(u.rate)}</span>
            <span className="text-[11px] font-semibold text-amber-200"> /{u.unit}</span>
            <span className="text-[10px] text-amber-300"> · {u.qty.toLocaleString("en-AU")} {u.unit}</span>
          </div>
        ))}
      </div>
    )}
    </div>
  );
}

/**
 * Full-screen markup viewer. Images: scroll-wheel or button zoom, drag to
 * pan, double-click to reset, rotate persists onto the markup itself (via
 * onRotate) so the drawing stays rotated everywhere, always. PDFs render in
 * the browser's own viewer, which brings its own zoom controls.
 */
function MarkupLightbox({ markup, onClose, onRotate }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clamp = (s) => Math.min(8, Math.max(0.2, s));
  const zoomBy = (f) => setScale((s) => clamp(s * f));
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  const onWheel = (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };
  const onMouseDown = (e) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPos({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col print:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-white flex-none">
        <span className="text-sm font-medium truncate">{markup.name}</span>
        <div className="flex items-center gap-1.5 flex-none">
          {markup.type === "image" && (
            <>
              <LbBtn onClick={() => zoomBy(1 / 1.3)} title="Zoom out"><ZoomOut size={16} /></LbBtn>
              <span className="text-xs font-mono tabular-nums w-12 text-center">{Math.round(scale * 100)}%</span>
              <LbBtn onClick={() => zoomBy(1.3)} title="Zoom in"><ZoomIn size={16} /></LbBtn>
              <LbBtn onClick={reset} title="Fit / reset"><Maximize2 size={16} /></LbBtn>
              <LbBtn onClick={onRotate} title="Rotate 90° — saved permanently"><RotateCw size={16} /></LbBtn>
            </>
          )}
          <LbBtn onClick={onClose} title="Close (Esc)"><X size={16} /></LbBtn>
        </div>
      </div>
      {markup.type === "pdf" ? (
        <embed src={markup.dataURL} type="application/pdf" className="flex-1 w-full bg-neutral-800" />
      ) : (
        <div
          className="flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onDoubleClick={reset}
        >
          <img
            src={markup.dataURL}
            alt={markup.name}
            draggable={false}
            className="max-w-[90%] max-h-[85vh] object-contain"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${markup.rotation || 0}deg)` }}
          />
        </div>
      )}
      <div className="text-center text-[11px] text-neutral-400 py-1.5 flex-none">
        {markup.type === "image" ? "Scroll to zoom · drag to pan · double-click to reset · rotation saves with the quote" : "Use the PDF viewer's own zoom controls"}
      </div>
    </div>
  );
}

function LbBtn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-md bg-white/10 hover:bg-white/25 text-white transition-colors"
    >
      {children}
    </button>
  );
}
