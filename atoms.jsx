import { Loader2, Check, AlertTriangle } from "lucide-react";

const STATUS_MAP = {
  loading: { icon: Loader2, text: "Loading…", cls: "text-neutral-400", spin: true },
  saving: { icon: Loader2, text: "Saving…", cls: "text-amber-600", spin: true },
  saved: { icon: Check, text: "Saved", cls: "text-emerald-600", spin: false },
  error: { icon: AlertTriangle, text: "Save failed — changes are local only", cls: "text-red-600", spin: false },
  unavailable: { icon: AlertTriangle, text: "No local storage — changes won't survive a refresh", cls: "text-amber-600", spin: false },
};

export function SaveBadge({ status }) {
  const m = STATUS_MAP[status] || STATUS_MAP.saved;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${m.cls}`}>
      <Icon size={13} className={m.spin ? "animate-spin" : ""} />
      {m.text}
    </span>
  );
}

export function NumInput({ value, onChange, placeholder = "—", className = "", step = "0.01" }) {
  return (
    <input
      type="number"
      step={step}
      value={value === undefined || value === null || value === "" ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      placeholder={placeholder}
      className={`w-full bg-amber-50 border border-amber-200 rounded px-2 py-1 text-right font-mono text-[13px] tabular-nums
                  focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 ${className}`}
    />
  );
}
