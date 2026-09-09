import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { RESOURCE_COLS } from "../data/catalog.js";
import { money2, labourResourceRate, taskRowMeta, rateKey } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

/**
 * The crew-sheet labour table, laid out exactly like BOMA's paper sheet:
 *   # | Task | Qty | Unit | Concrete Crew (3+) | Steel Crew (3+) |
 *   General Labour Crew (3+) | Excavator | Bobcat | Pump hr | Pump m³ |
 *   Crane | Factory | Notes  — with TOTAL / RATE / COST footer rows.
 *
 * Each row's Qty draws DIRECTLY from the quantities entered on the element's
 * line items (pour = concrete m³, tie = reinforcement t, finish = mesh m²).
 * Crew days follow as Qty × the rate-of-work rate from the Rates library and
 * appear as amber values; type over a Qty or a crew cell to override it,
 * clear the cell to hand it back.
 */
export default function LabourMatrix({
  item, rates, onTaskQtyChange, onTaskMetaChange, onAddTask, onRemoveTask, onRenameTask,
  resourceTotals, resourceCosts, labourTotal, labourOpen, toggleLabour,
  labourAuto, autoQtys, onToggleAuto, onResetAuto, labourQtyCtx, onLabourRateChange,
}) {
  return (
    <div className="border border-amber-300 rounded-lg overflow-hidden bg-white">
      <button
        onClick={toggleLabour}
        className="w-full px-3 py-2 bg-amber-800 text-white text-xs font-semibold tracking-wide uppercase flex items-center justify-between hover:bg-amber-700 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {labourOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Labour / Equipment — crew, day &amp; hour counts
        </span>
        <span className="font-mono tabular-nums normal-case font-semibold">{money2(labourTotal)}</span>
      </button>
      {labourOpen && (
      <>
      <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={!!labourAuto} onChange={onToggleAuto} className="accent-amber-700" />
          ⚡ Auto from quantities
        </label>
        <p className="text-[11px] text-amber-800/80 leading-snug m-0 flex-1">
          {labourAuto
            ? "Figures draw live from the entered quantities (every 10 m³ of concrete or 1 t of steel = one crew's day, pump 6 hrs + the m³ pumped) and keep their decimals. Every row starts PER PERSON — cells are man-days costed straight at the day rate — and stays that way until you switch it to per crew, where cells become crew-days costed days × that row's own men-per-crew (blank = 3, Steel Crew 5). Type over any cell to override; clear it to hand it back."
            : "Off — every cell is manual. Turn auto back on to draw Qty and crew days live from the entered quantities again (typed cells keep their values)."}
        </p>
        <button
          onClick={onResetAuto}
          title="Clear every typed Qty and crew cell on this sheet and re-derive everything live from the entered quantities"
          className="text-[11px] font-semibold text-amber-900 border border-amber-400 rounded px-2 py-0.5 hover:bg-amber-100 whitespace-nowrap transition-colors"
        >
          ↺ Reset to auto
        </button>
      </div>
      <div className="overflow-x-auto">
        {/* fixed minimum width: the sheet scrolls sideways rather than
            crushing its cells — every figure stays fully legible */}
        <table className="w-full min-w-[1330px] text-[13px]">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
              <th className="text-right px-2 py-1.5 font-medium w-8">#</th>
              <th className="text-left px-3 py-1.5 font-medium min-w-[180px]">Task</th>
              <th className="text-right px-2 py-1.5 font-medium min-w-[76px]">Qty</th>
              <th className="text-left px-1 py-1.5 font-medium w-10">Unit</th>
              {RESOURCE_COLS.map((r) => (
                <th key={r.key} className="text-right px-2 py-1.5 font-medium min-w-[84px]">
                  {r.name}<br />({r.crew ? "days" : r.unit})
                </th>
              ))}
              <th className="text-left px-2 py-1.5 font-medium min-w-[110px]">Notes</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {item.tasks.map((task, idx) => {
              const filled = RESOURCE_COLS.some((r) => Number(task.qtys[r.key]) > 0);
              const meta = taskRowMeta(task.name, labourQtyCtx);
              return (
              <tr key={task.id} className={`border-t border-neutral-100 ${filled ? "bg-orange-50/40" : ""}`}>
                <td className="px-2 py-1 text-right text-neutral-400 font-mono tabular-nums">{idx + 1}</td>
                <td className="px-3 py-1">
                  <input
                    value={task.name}
                    onChange={(e) => onRenameTask(task.id, e.target.value)}
                    className="w-full bg-transparent border-0 border-b border-dashed border-neutral-200 focus:border-orange-400 focus:outline-none text-neutral-700 text-[13px] py-0.5"
                  />
                  {/* Per-row crew mode: this row's crew cells are crew-days
                      (× its own men-per-crew) or straight man-days. */}
                  <div className="flex items-center gap-1 mt-0.5">
                    <select
                      value={task.crewMode === "crew" ? "crew" : "person"}
                      onChange={(e) => onTaskMetaChange(task.id, "crewMode", e.target.value)}
                      className="text-[10px] border border-amber-300 rounded px-1 py-0.5 text-amber-900 bg-amber-50 focus:outline-none focus:border-amber-500"
                    >
                      <option value="person">per person</option>
                      <option value="crew">per crew</option>
                    </select>
                    {task.crewMode === "crew" && (
                      <>
                        <span className="text-[10px] text-neutral-400">×</span>
                        <input
                          type="number" min="1" step="1"
                          value={task.crewSize ?? ""}
                          placeholder="men"
                          title="Persons in this row's crew — blank uses the column default (3; Steel Crew 5)"
                          onChange={(e) => onTaskMetaChange(task.id, "crewSize", e.target.value === "" ? undefined : e.target.value)}
                          className="w-12 text-[11px] border border-neutral-200 rounded px-1 py-0.5 text-right font-mono tabular-nums focus:outline-none focus:border-amber-500"
                        />
                        <span className="text-[10px] text-neutral-400">men</span>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1">
                  {meta.unit ? (
                    <NumInput
                      step="0.01"
                      value={task.qty}
                      placeholder={labourAuto && meta.autoQty ? String(meta.autoQty) : "—"}
                      className={labourAuto && meta.autoQty ? "placeholder:text-amber-800 placeholder:opacity-100 placeholder:font-semibold border-amber-400" : ""}
                      onChange={(v) => onTaskMetaChange(task.id, "qty", v)}
                    />
                  ) : <span className="block text-center text-neutral-300">—</span>}
                </td>
                <td className="px-1 py-1 text-neutral-500 text-xs">{meta.unit}</td>
                {RESOURCE_COLS.map((r) => {
                  const autoVal = labourAuto && autoQtys && autoQtys[task.id] ? autoQtys[task.id][r.key] : undefined;
                  // Crew cells keep their decimals (0.5 crew-days is half a
                  // day, not a rounded-up whole crew); plant days/hours are
                  // whole; pump m³ is a true measured volume.
                  const whole = !r.crew && r.key !== "pump_m3";
                  return (
                  <td key={r.key} className="px-2 py-1">
                    <NumInput
                      step={whole ? "1" : "0.5"}
                      value={task.qtys[r.key]}
                      placeholder={autoVal !== undefined ? String(autoVal) : "—"}
                      className={autoVal !== undefined ? "placeholder:text-amber-800 placeholder:opacity-100 placeholder:font-semibold border-amber-400" : ""}
                      onChange={(v) => {
                        const n = Number(v);
                        const clean = whole && v !== undefined && v !== "" && Number.isFinite(n) && !Number.isInteger(n) ? Math.ceil(n) : v;
                        onTaskQtyChange(task.id, r.key, clean);
                      }}
                    />
                  </td>
                  );
                })}
                <td className="px-2 py-1">
                  <input
                    value={task.notes || ""}
                    onChange={(e) => onTaskMetaChange(task.id, "notes", e.target.value)}
                    placeholder="—"
                    className="w-full bg-transparent border-0 border-b border-dashed border-neutral-200 focus:border-orange-400 focus:outline-none text-neutral-600 text-[12px] py-0.5"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <button onClick={() => onRemoveTask(task.id)} className="text-neutral-300 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
              );
            })}
            <tr className="border-t border-neutral-200 bg-neutral-50 font-semibold">
              <td></td>
              <td className="px-3 py-1 text-neutral-600 text-xs uppercase tracking-wide">Total</td>
              <td colSpan={2}></td>
              {RESOURCE_COLS.map((r) => (
                <td key={r.key} className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700">
                  {/* crew days and pump m³ keep decimals; plant days/hours whole */}
                  {r.crew || r.key === "pump_m3"
                    ? (resourceTotals[r.key] || 0).toLocaleString("en-AU", { maximumFractionDigits: 2 })
                    : String(Math.ceil((resourceTotals[r.key] || 0) - 1e-9))}
                </td>
              ))}
              <td colSpan={2}></td>
            </tr>
            <tr className="text-neutral-500 text-[12px]">
              <td></td>
              <td className="px-3 py-1 italic">Rate ($ per man-day per person for crews · $ / unit for plant) — editable, saves to the rates library</td>
              <td colSpan={2}></td>
              {RESOURCE_COLS.map((r) => (
                <td key={r.key} className="px-2 py-1">
                  <NumInput
                    step="1"
                    value={labourResourceRate(rates, r)}
                    onChange={(v) => onLabourRateChange && onLabourRateChange(r, v)}
                  />
                </td>
              ))}
              <td colSpan={2}></td>
            </tr>
            <tr className="border-t border-neutral-200 font-semibold">
              <td></td>
              <td className="px-3 py-1 text-neutral-700 text-xs uppercase tracking-wide">Cost ($)</td>
              <td colSpan={2}></td>
              {RESOURCE_COLS.map((r) => (
                <td key={r.key} className="px-2 py-1 text-right font-mono tabular-nums text-neutral-900">
                  {money2(resourceCosts[r.key])}
                </td>
              ))}
              <td colSpan={2}></td>
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
      </>
      )}
    </div>
  );
}
