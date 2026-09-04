import { useEffect, useState } from "react";
import { X, Copy, Check } from "lucide-react";

/**
 * Shown unconditionally whenever "Export Excel" is clicked — same reasoning
 * as PrintQuoteReport's preview modal: a script-triggered `<a download>`
 * blob save can be silently blocked in a sandboxed iframe (e.g. this app
 * hosted inside the portal shell inside an Artifact preview), with no
 * reliable way to detect that it failed.
 *
 * The preview below is the ACTUAL formatted table (rendered in an iframe so
 * its own inline styles don't collide with the app's Tailwind), and "Copy
 * formatted table" puts both an HTML clipboard entry (so pasting into
 * Excel/Sheets/Word keeps the bold headers, colour bands and borders) and a
 * plain-text CSV entry (so a paste target that only reads plain text still
 * gets usable, comma-separated content) on the clipboard in one call.
 */
export default function ExportExcelModal({ filename, html, plainText, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
        setCopied(true);
        setCopyError(false);
      } else {
        await navigator.clipboard.writeText(plainText);
        setCopied(true);
        setCopyError(false);
      }
    } catch (e) {
      setCopied(false);
      setCopyError(true);
    }
  };

  useEffect(() => {
    copy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="print:hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-neutral-200 bg-amber-50 rounded-t-xl">
          <div className="text-[13px] text-neutral-800">
            <b>Export — {filename}.</b> If the download didn't start on its own (this preview's sandbox can silently
            block it), the table below is copied to your clipboard{copied ? "" : " — press Copy"} with full
            formatting: paste straight into Excel or Google Sheets.
          </div>
          <button
            onClick={onClose}
            className="flex-none p-1.5 rounded-lg hover:bg-amber-100 text-neutral-500 hover:text-neutral-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 flex-1 flex flex-col gap-2">
          <button
            onClick={copy}
            className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied — formatting included" : "Copy formatted table"}
          </button>
          {copyError && (
            <div className="text-xs text-red-600">
              Clipboard access isn't available here — select the table below directly (click inside it, Ctrl+A / Cmd+A,
              then Ctrl+C / Cmd+C) and paste into Excel.
            </div>
          )}
          <iframe
            title="Excel export preview"
            srcDoc={html}
            className="flex-1 min-h-[50vh] w-full border border-neutral-200 rounded-lg bg-white"
          />
        </div>
      </div>
    </div>
  );
}
