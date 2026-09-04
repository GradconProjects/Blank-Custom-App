import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Copy, Trash2 } from "lucide-react";
import { FULL_CATALOG } from "../data/catalog.js";
import { uid, money2, computeElementCost } from "../lib/costing.js";
import CategoryBlock from "./CategoryBlock.jsx";
import LabourMatrix from "./LabourMatrix.jsx";
import AdditionalItems from "./AdditionalItems.jsx";

export default function ElementCard({ item, rates, onChange, onRemove, onDuplicate }) {
  const [openCats, setOpenCats] = useState(() => {
    const o = {};
    FULL_CATALOG.forEach((c) => { o[c.key] = c.key === "CONCRETE"; });
    return o;
  });
  const [cardOpen, setCardOpen] = useState(true);

  const cost = useMemo(() => computeElementCost(item, rates), [item, rates]);

  const patch = (fn) => onChange(fn(item));

  const setQty = (qKey, v) => patch((it) => ({ ...it, qtys: { ...it.qtys, [qKey]: v } }));
  const setLabel = (v) => patch((it) => ({ ...it, label: v }));
  const addTask = () => patch((it) => ({ ...it, tasks: [...it.tasks, { id: uid(), name: "New task", qtys: {} }] }));
  const removeTask = (taskId) => patch((it) => ({ ...it, tasks: it.tasks.filter((t) => t.id !== taskId) }));
  const renameTask = (taskId, name) => patch((it) => ({ ...it, tasks: it.tasks.map((t) => (t.id === taskId ? { ...t, name } : t)) }));
  const setTaskQty = (taskId, resKey, v) =>
    patch((it) => ({ ...it, tasks: it.tasks.map((t) => (t.id === taskId ? { ...t, qtys: { ...t.qtys, [resKey]: v } } : t)) }));

  const addAdditional = () =>
    patch((it) => ({ ...it, additional: [...it.additional, { id: uid(), name: "", unit: "", qty: undefined, rate: undefined }] }));
  const removeAdditional = (id) => patch((it) => ({ ...it, additional: it.additional.filter((a) => a.id !== id) }));
  const changeAdditional = (id, field, v) =>
    patch((it) => ({ ...it, additional: it.additional.map((a) => (a.id === id ? { ...a, [field]: v } : a)) }));

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-blue-950 text-white px-4 py-3 flex items-center gap-3">
        <button onClick={() => setCardOpen(!cardOpen)} className="text-blue-300 hover:text-white transition-colors flex-none">
          {cardOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold">
            {item.category} {item.category && item.section ? "›" : ""} {item.section}
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

          {FULL_CATALOG.map((cat) => (
            <CategoryBlock
              key={cat.key}
              cat={cat}
              item={item}
              rates={rates}
              onQtyChange={setQty}
              catOpen={openCats[cat.key]}
              toggleCat={() => setOpenCats((o) => ({ ...o, [cat.key]: !o[cat.key] }))}
              catTotal={cost.categoryTotals[cat.key]}
            />
          ))}

          <LabourMatrix
            item={item}
            rates={rates}
            onTaskQtyChange={setTaskQty}
            onAddTask={addTask}
            onRemoveTask={removeTask}
            onRenameTask={renameTask}
            resourceTotals={cost.resourceTotals}
            resourceCosts={cost.resourceCosts}
            labourTotal={cost.labourTotal}
          />

          <AdditionalItems
            item={item}
            onAdd={addAdditional}
            onRemove={removeAdditional}
            onChange={changeAdditional}
            total={cost.additionalTotal}
          />
        </div>
      )}
    </div>
  );
}
