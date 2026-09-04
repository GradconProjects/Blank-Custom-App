import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { FULL_CATALOG, RESOURCE_COLS } from "../data/catalog.js";
import { money2, rateKey, lookupRate } from "../lib/costing.js";
import { NumInput } from "./atoms.jsx";

export default function AdditionalItems({ item, rates, onAdd, onRemove, onChange, onFill, total }) {
  // Rolled up by default like every other section of the card.
  const [open, setOpen] = useState(false);
  // "Pick from catalog" prefill: selecting a product (or labour resource)
  // fills name/unit/rate in ONE patch (see fillAdditional in ElementCard —
  // three separate onChange calls would each start from the same stale item
  // and lose each other's fields). Everything stays fully editable after —
  // the pick is a starting point, not a lock. Rates come through lookupRate
  // so a price edited in the Rates modal is what lands here, falling back to
  // the catalog default.
  const handlePick = (id, val) => {
    if (!val) return;
    const [kind, i, j] = val.split(":").map((s, idx) => (idx === 0 ? s : Number(s)));
    if (kind === "m") {
      const cat = FULL_CATALOG[i];
      const p = cat.products[j];
      const rate = lookupRate(rates, rateKey(cat.key, p.name, p.unit), { unitCost: p.unitCost ?? 0 });
      onFill(id, { name: p.name, unit: p.unit || "", rate: rate.unitCost ?? 0 });
    } else {
      const res = RESOURCE_COLS[i];
      const rate = lookupRate(rates, rateKey("LABOUR", res.name, res.unit), { unitCost: res.rate });
      onFill(id, { name: `${res.name} (${res.unit})`, unit: res.unit, rate: rate.unitCost ?? 0 });
    }
  };

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 bg-neutral-800 text-white text-xs font-semibold tracking-wide uppercase flex items-center justify-between"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Other Allowances / Custom Items {item.additional.length > 0 && <span className="text-neutral-400 normal-case">({item.additional.length})</span>}
        </span>
        <span className="font-mono tabular-nums normal-case font-semibold text-orange-300">{money2(total)}</span>
      </button>
      {open && (
      <div className="p-2 space-y-1.5">
        {item.additional.map((a) => (
          <div key={a.id} className="flex items-center gap-1.5">
            <select
              value=""
              onChange={(e) => handlePick(a.id, e.target.value)}
              title="Prefill from the materials catalog or labour rates — stays editable after"
              className="w-9 flex-none border border-neutral-200 rounded px-1 py-1 text-[13px] text-neutral-500 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-orange-400 cursor-pointer"
            >
              <option value="">▾</option>
              {FULL_CATALOG.map((cat, i) => (
                <optgroup key={cat.key} label={cat.key}>
                  {cat.products.map((p, j) => (
                    <option key={j} value={`m:${i}:${j}`}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="LABOUR / EQUIPMENT">
                {RESOURCE_COLS.map((res, i) => (
                  <option key={res.key} value={`l:${i}`}>{res.name} ({res.unit})</option>
                ))}
              </optgroup>
            </select>
            <input
              value={a.name}
              onChange={(e) => onChange(a.id, "name", e.target.value)}
              placeholder="Description (e.g. Difficult access allowance) — or pick from the catalog ◂"
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
          <Plus size={13} /> Add allowance / custom line
        </button>
      </div>
      )}
    </div>
  );
}
