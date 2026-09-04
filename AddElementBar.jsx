import { useState } from "react";
import { Plus } from "lucide-react";
import { CATEGORY_ORDER, ELEMENT_TYPES } from "../data/catalog.js";

export default function AddElementBar({ onAdd, elementTypes = ELEMENT_TYPES, categoryOrder = CATEGORY_ORDER }) {
  const [sel, setSel] = useState("");
  return (
    <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-xl p-2 shadow-sm">
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
      >
        <option value="">Select an element to add to the quote…</option>
        {categoryOrder.map((category) => (
          <optgroup key={category} label={category}>
            {elementTypes.filter((t) => t.category === category).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        onClick={() => { if (sel) { onAdd(sel); setSel(""); } }}
        disabled={!sel}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white text-sm font-semibold transition-colors flex-none"
      >
        <Plus size={16} /> Add to quote
      </button>
    </div>
  );
}
