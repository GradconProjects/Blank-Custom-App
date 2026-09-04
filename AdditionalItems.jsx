import { Plus, Trash2 } from "lucide-react";
import { money2 } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

export default function AdditionalItems({ item, onAdd, onRemove, onChange, total }) {
  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
      <div className="px-3 py-2 bg-neutral-800 text-white text-xs font-semibold tracking-wide uppercase flex items-center justify-between">
        <span>Custom / One-off Items</span>
        <span className="font-mono tabular-nums normal-case font-semibold text-orange-300">{money2(total)}</span>
      </div>
      <div className="p-2 space-y-1.5">
        {item.additional.map((a) => (
          <div key={a.id} className="flex items-center gap-1.5">
            <input
              value={a.name}
              onChange={(e) => onChange(a.id, "name", e.target.value)}
              placeholder="Description (e.g. Difficult access allowance)"
              className="flex-1 border border-neutral-200 rounded px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <input
              value={a.unit}
              onChange={(e) => onChange(a.id, "unit", e.target.value)}
              placeholder="unit"
              className="w-16 border border-neutral-200 rounded px-2 py-1 text-[13px] text-center focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <NumInput value={a.qty} onChange={(v) => onChange(a.id, "qty", v)} className="w-20 flex-none" />
            <NumInput value={a.rate} onChange={(v) => onChange(a.id, "rate", v)} className="w-24 flex-none" />
            <span className="w-24 text-right font-mono text-[13px] tabular-nums text-neutral-800 flex-none">
              {money2((Number(a.qty) || 0) * (Number(a.rate) || 0))}
            </span>
            <button onClick={() => onRemove(a.id)} className="text-neutral-300 hover:text-red-500 transition-colors flex-none">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50 rounded transition-colors"
        >
          <Plus size={13} /> Add custom line
        </button>
      </div>
    </div>
  );
}
