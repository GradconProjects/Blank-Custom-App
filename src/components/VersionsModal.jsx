import { useEffect, useState } from "react";
import { X, History, Download, RotateCcw, Loader2 } from "lucide-react";
import { listVersions, loadVersion, downloadQuoteFile } from "../lib/quoteVersions.js";
import { formatFileSize } from "../lib/storageFiles.js";

const SOURCE_LABEL = { manual: "Saved", autosave: "Autosave", "before-restore": "Before a restore", import: "Opened from file" };

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Every saved version of this project, newest first. Restore is two-click
 * (arm, then confirm — no native confirm() dialogs, they can be blocked in
 * an embedded iframe) and the caller snapshots the current state before
 * replacing it, so a restore is itself reversible from this same list.
 */
export default function VersionsModal({ projectId, projectName, onRestore, onClose, autosaveMinutes }) {
  const [versions, setVersions] = useState(null);
  const [busy, setBusy] = useState(null);       // path being restored/downloaded
  const [armed, setArmed] = useState(null);     // path awaiting restore confirmation
  const [error, setError] = useState(null);

  const refresh = async () => setVersions(await listVersions(projectId));
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const restore = async (v) => {
    setBusy(v.path); setError(null);
    try {
      const doc = await loadVersion(v.path);
      await onRestore(doc.quote, v);
      setArmed(null);
      await refresh();                              // the "before-restore" copy now shows
    } catch (e) {
      setError(`Couldn't restore that version: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };
  const download = async (v) => {
    setBusy(v.path); setError(null);
    try {
      const doc = await loadVersion(v.path);
      await downloadQuoteFile(projectId, doc.quote, v.source);
    } catch (e) {
      setError(`Couldn't download that version: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 bg-blue-950 text-white rounded-t-xl">
          <div className="flex items-center gap-2 font-semibold"><History size={18} /> Versions — {projectName || "Untitled project"}</div>
          <button onClick={onClose} className="text-blue-200 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 text-xs text-neutral-500 border-b border-neutral-100">
          A version is a complete copy of this quote, drawings included, kept for good. One is saved every time you click <b>Save</b>
          {autosaveMinutes > 0 ? <>, and automatically every <b>{autosaveMinutes} min</b> while the quote is changing</> : null}
          {" "}(change the interval under the portal's Settings). Restoring keeps a copy of what you have now, so it can be undone from here too.
        </div>
        {error && <div className="mx-5 mt-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">{error}</div>}
        <div className="max-h-[60vh] overflow-y-auto">
          {versions === null && <div className="px-5 py-8 text-sm text-neutral-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading versions…</div>}
          {versions && versions.length === 0 && (
            <div className="px-5 py-8 text-sm text-neutral-400">No versions yet — click <b>Save</b> to keep the first one.</div>
          )}
          {versions && versions.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
                  <th className="text-left px-5 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">How</th>
                  <th className="text-right px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.path} className="border-t border-neutral-100">
                    <td className="px-5 py-2 font-mono tabular-nums text-neutral-800">{when(v.savedAt)}{i === 0 && <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">latest</span>}</td>
                    <td className="px-3 py-2 text-neutral-600">{SOURCE_LABEL[v.source] || v.source}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-500">{formatFileSize(v.size)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => download(v)}
                        disabled={busy === v.path}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50 mr-2 disabled:opacity-50"
                        title="Save this version as a file on this computer"
                      >
                        <Download size={13} /> Download
                      </button>
                      {armed === v.path ? (
                        <button
                          onClick={() => restore(v)}
                          disabled={busy === v.path}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          title="Replace the current quote with this version (what you have now is kept as a version first)"
                        >
                          {busy === v.path ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Confirm restore
                        </button>
                      ) : (
                        <button
                          onClick={() => { setArmed(v.path); setTimeout(() => setArmed((cur) => (cur === v.path ? null : cur)), 4000); }}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
                        >
                          <RotateCcw size={13} /> Restore
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
  );
}
