import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, File, FolderOpen, FolderUp, Loader2, MessageSquarePlus, Trash2, Upload } from "lucide-react";
import { readQuotes, writeQuote } from "../lib/projects.js";
import { uid } from "../lib/costing.js";
import { supabaseEnabled } from "../lib/supabaseClient.js";
import { OFFICE_FOLDER_PATH, projectFolderPath, listFiles, uploadFile, deleteFile, formatFileSize, groupFilesByMonthDay } from "../lib/storageFiles.js";

const CHANNELS = ["Call", "Email", "Site meeting", "Text/WhatsApp", "Other"];

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}
function lastUploadDateLabel(iso) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** File list + upload for one folder path (an Office-wide folder, or one
 * project's own folder — same UI either way, see storageFiles.js). Picking
 * files (or an entire folder, via the "Choose folder" picker) stages them
 * first, each with an editable name (defaulting to the original filename,
 * or its path within the picked folder) — nothing uploads until confirmed,
 * so a custom name is set before the file ever leaves the browser. Storage
 * here is a flat per-folder list, so a folder upload's relative path is
 * just flattened into the stored filename, not a real subfolder. The
 * already-uploaded list folds into Month -> Day groups, newest first, each
 * collapsed by default. */
function FileFolder({ folderPath, onFilesChange }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState([]); // [{file, name}]
  const [uploading, setUploading] = useState(false);
  const [openGroups, setOpenGroups] = useState({}); // "month" or "month|dateKey" -> bool
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);

  const refresh = () => {
    setLoading(true);
    listFiles(folderPath).then((f) => { setFiles(f); setLoading(false); onFilesChange?.(f); });
  };
  useEffect(refresh, [folderPath]);

  // Shared by both the plain file picker and the folder picker (the latter
  // sets webkitRelativePath on every File, e.g. "MyFolder/sub/plan.pdf") —
  // storage here is a flat, per-folder list (see storageFiles.js), so a
  // folder upload's relative path becomes the staged default name, keeping
  // the structure visible instead of silently losing it.
  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    setPending((p) => [...p, ...picked.map((file) => ({ file, name: file.webkitRelativePath || file.name }))]);
    e.target.value = "";
  };
  const renamePending = (i, name) => setPending((p) => p.map((x, idx) => (idx === i ? { ...x, name } : x)));
  const removePending = (i) => setPending((p) => p.filter((_, idx) => idx !== i));

  const confirmUpload = async () => {
    if (pending.length === 0) return;
    setUploading(true);
    for (const { file, name } of pending) {
      try { await uploadFile(folderPath, file, name); } catch (err) { /* best-effort per file */ }
    }
    setUploading(false);
    setPending([]);
    refresh();
  };

  const onDelete = async (path) => {
    await deleteFile(path);
    refresh();
  };

  const groups = useMemo(() => groupFilesByMonthDay(files), [files]);
  const toggleGroup = (key) => setOpenGroups((g) => ({ ...g, [key]: !g[key] }));

  if (!supabaseEnabled) {
    return <div className="text-xs text-neutral-400 italic py-2">File storage needs this app connected to Supabase.</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-neutral-400">{files.length} file{files.length === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 cursor-pointer">
            <Upload size={13} /> Choose files
            <input ref={inputRef} type="file" multiple onChange={onPick} className="hidden" />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 cursor-pointer">
            <FolderUp size={13} /> Choose folder
            <input
              ref={folderInputRef}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={onPick}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mb-3 p-2 bg-neutral-50 rounded-lg border border-neutral-200 space-y-1.5">
          <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Name before uploading</div>
          {pending.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={p.name}
                onChange={(e) => renamePending(i, e.target.value)}
                className="flex-1 min-w-0 border border-neutral-200 rounded px-1.5 py-1 text-xs"
              />
              <button onClick={() => removePending(i)} className="text-neutral-300 hover:text-red-600 flex-none">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={confirmUpload}
            disabled={uploading}
            className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-700 disabled:bg-neutral-300 text-white text-xs font-semibold"
          >
            {uploading ? "Uploading…" : `Upload ${pending.length} file${pending.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-neutral-400"><Loader2 size={12} className="inline animate-spin mr-1" /> Loading…</div>
      ) : files.length === 0 ? (
        <div className="text-xs text-neutral-400 italic">No files yet.</div>
      ) : (
        <div className="space-y-1">
          {groups.map((g) => (
            <div key={g.month}>
              <button
                onClick={() => toggleGroup(g.month)}
                className="w-full flex items-center gap-1 text-xs font-semibold text-neutral-600 py-1"
              >
                {openGroups[g.month] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {g.month} <span className="text-neutral-400 font-normal">({g.days.reduce((s, d) => s + d.files.length, 0)})</span>
              </button>
              {openGroups[g.month] && (
                <div className="pl-4 space-y-1">
                  {g.days.map((d) => {
                    const dayKey = `${g.month}|${d.dateKey}`;
                    return (
                      <div key={dayKey}>
                        <button
                          onClick={() => toggleGroup(dayKey)}
                          className="w-full flex items-center gap-1 text-[11px] font-medium text-neutral-500 py-0.5"
                        >
                          {openGroups[dayKey] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          {d.day} <span className="text-neutral-400 font-normal">({d.files.length})</span>
                        </button>
                        {openGroups[dayKey] && (
                          <div className="pl-4 space-y-1">
                            {d.files.map((f) => (
                              <FileRow key={f.path} f={f} onDelete={() => onDelete(f.path)} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ f, onDelete }) {
  return (
    <div className="flex items-center gap-2 text-xs group">
      <File size={13} className="text-neutral-400 flex-none" />
      <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-900 hover:underline truncate flex-1 min-w-0">{f.name}</a>
      <span className="text-neutral-400 flex-none">{timeLabel(f.uploadedAt)}</span>
      <span className="text-neutral-400 flex-none">{formatFileSize(f.size)}</span>
      <button
        onClick={onDelete}
        className="text-neutral-300 hover:text-red-600 flex-none opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete file"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** Manual communications log — used both for the Office-wide log (state
 * lives in App.jsx, via props) and reused inline for a project's own log
 * (state lives in that project's quote.communications, via onAdd). */
function CommsLog({ entries, onAdd }) {
  const [logging, setLogging] = useState(false);
  const [draft, setDraft] = useState({ date: new Date().toISOString().slice(0, 10), contact: "", channel: CHANNELS[0], summary: "" });

  const submit = () => {
    if (!draft.summary.trim()) return;
    onAdd({ id: uid(), ...draft });
    setDraft({ date: new Date().toISOString().slice(0, 10), contact: "", channel: CHANNELS[0], summary: "" });
    setLogging(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-neutral-400">{entries.length} logged</span>
        <button onClick={() => setLogging(!logging)} className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700">
          <MessageSquarePlus size={13} /> Log communication
        </button>
      </div>
      {logging && (
        <div className="mb-2 p-2 bg-neutral-50 rounded-lg border border-neutral-200 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} className="border border-neutral-200 rounded px-2 py-1 text-xs" />
            <input placeholder="Contact" value={draft.contact} onChange={(e) => setDraft((d) => ({ ...d, contact: e.target.value }))} className="border border-neutral-200 rounded px-2 py-1 text-xs" />
            <select value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))} className="border border-neutral-200 rounded px-2 py-1 text-xs">
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <textarea
            placeholder="Summary"
            value={draft.summary}
            onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
            rows={2}
            className="w-full border border-neutral-200 rounded px-2 py-1 text-xs"
          />
          <button onClick={submit} className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold">Add</button>
        </div>
      )}
      {entries.length === 0 ? (
        <div className="text-xs text-neutral-400 italic">Nothing logged yet.</div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((c) => (
            <div key={c.id} className="text-xs text-neutral-600 flex gap-2">
              <span className="text-neutral-400 flex-none">{c.date}</span>
              <span className="font-medium flex-none">{c.channel}{c.contact ? ` · ${c.contact}` : ""}</span>
              <span className="text-neutral-500">{c.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectFolderCard({ project, name, communications, onAddCommunication, onOpen }) {
  const [open, setOpen] = useState(false);
  // Fetched independently of `open` (not just once the Documents panel is
  // expanded) so the "last upload" line is visible on the collapsed row too.
  const [lastFile, setLastFile] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!supabaseEnabled) return;
    listFiles(projectFolderPath(project.id)).then((files) => { if (!cancelled) setLastFile(files[0] || null); });
    return () => { cancelled = true; };
  }, [project.id]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start justify-between px-4 py-3 text-left">
        <span className="flex items-start gap-2 min-w-0">
          {open ? <ChevronDown size={16} className="text-neutral-400 mt-0.5 flex-none" /> : <ChevronRight size={16} className="text-neutral-400 mt-0.5 flex-none" />}
          <FolderOpen size={16} className="text-orange-500 mt-0.5 flex-none" />
          <span className="min-w-0">
            <span className="block font-semibold text-[15px] text-neutral-900">{name}</span>
            {lastFile && (
              <span className="block text-xs italic text-neutral-400 truncate">
                Last upload: {lastFile.name} — {lastUploadDateLabel(lastFile.uploadedAt)}
              </span>
            )}
          </span>
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); onOpen(project.id); }}
          className="flex items-center gap-1 text-xs font-medium text-blue-900 hover:text-blue-700 flex-none"
        >
          Open project <ArrowRight size={13} />
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-neutral-100 pt-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">Documents</div>
            <FileFolder folderPath={projectFolderPath(project.id)} onFilesChange={(files) => setLastFile(files[0] || null)} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">Communications</div>
            <CommsLog entries={communications} onAdd={onAddCommunication} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectFolderView({ projects, officeComms, setOfficeComms, onOpen }) {
  const [quotesByKey, setQuotesByKey] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readQuotes(projects.map((p) => p.storageKey)).then((map) => {
      if (cancelled) return;
      setQuotesByKey(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projects]);

  const rows = useMemo(
    () => projects.map((p) => {
      const quote = quotesByKey[p.storageKey] || {};
      return { project: p, name: quote.projectName || "Untitled project", communications: quote.communications || [] };
    }),
    [projects, quotesByKey]
  );

  const addProjectCommunication = (project, entry) => {
    const quote = quotesByKey[project.storageKey] || {};
    const list = quote.communications || [];
    const updated = { ...quote, communications: [entry, ...list] };
    setQuotesByKey((m) => ({ ...m, [project.storageKey]: updated }));
    writeQuote(project.storageKey, updated);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
          <FolderOpen size={20} className="text-orange-500" /> Gradcon Vault
        </h1>
        <p className="text-sm text-neutral-500">
          Documents and communications — one folder per project, plus a shared Office folder for company-wide files.
        </p>
      </div>

      <div className="rounded-xl border-2 border-orange-200 bg-orange-50/40 p-4">
        <div className="flex items-center gap-2 font-semibold text-[15px] text-neutral-900 mb-3">
          <FolderOpen size={16} className="text-orange-500" /> Office
          <span className="text-xs font-normal text-neutral-500">— company-wide files &amp; communications, not tied to one project</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">Files</div>
            <FileFolder folderPath={OFFICE_FOLDER_PATH} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">Communications received</div>
            <CommsLog entries={officeComms} onAdd={(entry) => setOfficeComms((list) => [entry, ...list])} />
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-neutral-700 mb-2">Project folders</div>
        {loading && rows.length === 0 ? (
          <div className="text-center py-8 text-neutral-400"><Loader2 size={16} className="inline animate-spin mr-1.5" /> Loading projects…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-neutral-400 border-2 border-dashed border-neutral-200 rounded-xl">
            No projects yet — add one from the Dashboard first.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <ProjectFolderCard
                key={r.project.id}
                project={r.project}
                name={r.name}
                communications={r.communications}
                onAddCommunication={(entry) => addProjectCommunication(r.project, entry)}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
