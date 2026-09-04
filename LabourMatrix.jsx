import { Plus, Trash2 } from "lucide-react";
import { RESOURCE_COLS } from "../data/catalog.js";
import { rateKey, money2, lookupRate } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

export default function LabourMatrix({
  item, rates, onTaskQtyChange, onAddTask, onRemoveTask, onRenameTask,
  resourceTotals, resourceCosts, labourTotal,
}) {
  return (
    <div className="border border-amber-300 rounded-lg overflow-hidden bg-white">
      <div className="px-3 py-2 bg-amber-800 text-white text-xs font-semibold tracking-wide uppercase flex items-center justify-between">
        <span>Labour / Equipment — day &amp; hour counts</span>
        <span className="font-mono tabular-nums normal-case font-semibold">{money2(labourTotal)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
              <th className="text-left px-3 py-1.5 font-medium min-w-[190px]">Task</th>
              {RESOURCE_COLS.map((r) => (
                <th key={r.key} className="text-right px-2 py-1.5 font-medium w-20">{r.name}<br />({r.unit})</th>
              ))}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {item.tasks.map((task) => (
              <tr key={task.id} className="border-t border-neutral-100">
                <td className="px-3 py-1">
                  <input
                    value={task.name}
                    onChange={(e) => onRenameTask(task.id, e.target.value)}
                    className="w-full bg-transparent border-0 border-b border-dashed border-neutral-200 focus:border-orange-400 focus:outline-none text-neutral-700 text-[13px] py-0.5"
                  />
                </td>
                {RESOURCE_COLS.map((r) => (
                  <td key={r.key} className="px-2 py-1">
                    <NumInput
                      step="0.5"
                      value={task.qtys[r.key]}
                      onChange={(v) => onTaskQtyChange(task.id, r.key, v)}
                    />
                  </td>
                ))}
                <td className="px-1 py-1 text-center">
                  <button onClick={() => onRemoveTask(task.id)} className="text-neutral-300 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-neutral-200 bg-neutral-50 font-semibold">
              <td className="px-3 py-1 text-neutral-600 text-xs uppercase tracking-wide">Total</td>
              {RESOURCE_COLS.map((r) => (
                <td key={r.key} className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700">
                  {(resourceTotals[r.key] || 0).toFixed(2)}
                </td>
              ))}
              <td></td>
            </tr>
            <tr className="text-neutral-400 italic text-[12px]">
              <td className="px-3 py-1">Rate ($/unit)</td>
              {RESOURCE_COLS.map((r) => (
                <td key={r.key} className="px-2 py-1 text-right font-mono tabular-nums">
                  {money2(lookupRate(rates, rateKey("LABOUR", r.name, r.unit), { unitCost: r.rate }).unitCost)}
                </td>
              ))}
              <td></td>
            </tr>
            <tr className="border-t border-neutral-200 font-semibold">
              <td className="px-3 py-1 text-neutral-700 text-xs uppercase tracking-wide">Cost ($)</td>
              {RESOURCE_COLS.map((r) => (
                <td key={r.key} className="px-2 py-1 text-right font-mono tabular-nums text-neutral-900">
                  {money2(resourceCosts[r.key])}
                </td>
              ))}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        onClick={onAddTask}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50 border-t border-amber-200 transition-colors"
      >
        <Plus size={13} /> Add task row
      </button>
    </div>
  );
}
