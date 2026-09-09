import { useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import { CATEGORY_ORDER, SECTION_ORDER } from "../data/catalog.js";

const LABOUR_OPTIONS = [
  ["excavation", "Excavation / earthworks"],
  ["footing", "Footing / foundation pour"],
  ["wall", "Wall (formed both faces)"],
  ["slab_ground", "Ground-bearing slab"],
  ["slab_suspended", "Suspended slab"],
];

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom";

/**
 * Self-service catalog extension: lets Grady add new element types (the
 * Add-Element dropdown entries) from the app itself instead of asking for
 * a code change every time a new job needs one. Custom types are stored
 * separately (boma-custom-element-types) and merged with the built-in
 * ELEMENT_TYPES at render time everywhere the combined list is needed
 * (see App.jsx) — the built-in catalog in data/catalog.js is never
 * modified, so this can't drift or conflict with it.
 */
export default function ManageElementTypesModal({ customTypes, setCustomTypes, onClose }) {
  const [category, setCategory] = useState("");
  const [section, setSection] = useState("");
  const [name, setName] = useState("");
  const [labour, setLabour] = useState("footing");
  const [error, setError] = useState("");
  // Two-click confirm instead of window.confirm() — see Dashboard.jsx's
  // armDelete comment for why: a native confirm() dialog can be silently
  // blocked inside a sandboxed/embedded iframe.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const add = () => {
    if (!category.trim() || !section.trim() || !name.trim()) {
      setError("Category, section and name are all required.");
      return;
    }
    const id = `custom_${slugify(name)}_${Date.now().toString(36)}`;
    setCustomTypes((cs) => [...cs, { id, category: category.trim(), section: section.trim(), name: name.trim(), labour }]);
    setCategory(""); setSection(""); setName(""); setLabour("footing"); setError("");
  };

  const remove = (id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    setCustomTypes((cs) => cs.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
          <div>
            <h2 className="font-semibold text-neutral-800">Element types — add your own</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Adds a new entry to the Add-Element dropdown. Every material/labour category still shows on every
              element automatically — you're only naming the element and picking which task sequence it follows.
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 flex-none"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          <div className="border border-neutral-200 rounded-lg p-3 space-y-2 bg-neutral-50">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-neutral-600 space-y-1">
                <span className="font-medium">Category</span>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  list="element-category-options"
                  placeholder="e.g. FOUNDATIONS"
                  className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
                />
                <datalist id="element-category-options">
                  {CATEGORY_ORDER.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label className="text-xs text-neutral-600 space-y-1">
                <span className="font-medium">Section</span>
                <input
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  list="element-section-options"
                  placeholder="e.g. FOOTINGS"
                  className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
                />
                <datalist id="element-section-options">
                  {SECTION_ORDER.map((s) => <option key={s} value={s} />)}
                </datalist>
              </label>
            </div>
            <label className="text-xs text-neutral-600 space-y-1 block">
              <span className="font-medium">Element name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Precast Panel"
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-neutral-600 space-y-1 block">
              <span className="font-medium">Labour / task sequence</span>
              <select
                value={labour}
                onChange={(e) => setLabour(e.target.value)}
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm bg-white"
              >
                {LABOUR_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {error && <div className="text-xs text-red-600">{error}</div>}
            <button
              onClick={add}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
            >
              <Plus size={14} /> Add element type
            </button>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
              Custom types ({customTypes.length})
            </div>
            {customTypes.length === 0 ? (
              <div className="text-sm text-neutral-400 py-4 text-center">None added yet.</div>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {customTypes.map((t) => (
                    <tr key={t.id} className="border-t border-neutral-100">
                      <td className="py-1.5 pr-2 text-neutral-500 text-xs">{t.category} › {t.section}</td>
                      <td className="py-1.5 pr-2 text-neutral-800">{t.name}</td>
                      <td className="py-1.5 pr-2">
                        {confirmDeleteId === t.id ? (
                          <button
                            onClick={() => remove(t.id)}
                            className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold whitespace-nowrap"
                          >
                            Confirm?
                          </button>
                        ) : (
                          <button onClick={() => remove(t.id)} className="text-neutral-400 hover:text-red-600">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
