/**
 * PDF → JPEG page renderer for markup uploads. A PDF markup used to live
 * inside the browser's cramped <embed> viewer — no zoom, no rotate, no
 * print fidelity. Converting each page to a JPEG at upload time makes every
 * markup a plain image: it rotates (and the rotation persists with the
 * quote), zooms in the lightbox, and prints.
 *
 * pdfjs-dist is imported STATICALLY and its worker is inlined (`?worker&
 * inline`): the Quotes app is folded into one self-contained HTML document
 * and runs from a blob: URL inside the portal, so nothing can be fetched
 * from a relative asset path at runtime.
 */
import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

let workerReady = false;
function ensureWorker() {
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    workerReady = true;
  }
}

/**
 * Render a PDF (as a data: URL) to JPEG data URLs, one per page.
 * Pages are rendered at up to `targetWidth` px wide (capped at 3x natural
 * scale) — sharp enough to zoom into text, small enough to keep the quote
 * blob saveable. Page count is capped so a 60-page drawing set can't blow
 * out storage; the caller is told the true page count to warn about it.
 */
export async function pdfToJpegPages(dataURL, { maxPages = 8, targetWidth = 1600, quality = 0.82 } = {}) {
  ensureWorker();
  const bin = atob(dataURL.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, targetWidth / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push(canvas.toDataURL("image/jpeg", quality));
    page.cleanup();
  }
  await doc.destroy();
  return { pages, numPages: doc.numPages };
}
