/**
 * PDF → JPEG page renderer for markup uploads. A PDF markup used to live
 * inside the browser's cramped <embed> viewer — no zoom, no rotate, no
 * print fidelity. Converting each page to a JPEG at upload time makes every
 * markup a plain image: it rotates (and the rotation persists with the
 * quote), zooms in the lightbox, and prints.
 *
 * pdfjs-dist is loaded LAZILY, on the first conversion. It is by far the
 * heaviest thing in the Quotes bundle (the inlined worker alone is ~1.4 MB
 * before base64), and it is only ever needed when someone clicks "→ Images"
 * on a PDF markup — every other load of the app was paying to download and
 * compile it for nothing. Vite splits the dynamic imports below into their
 * own chunk; scripts/assemble-portal.mjs rewrites that chunk's import to an
 * absolute URL, because the Quotes app runs from a blob: URL inside the
 * portal where a relative asset path cannot resolve (see the comment there).
 *
 * If the chunk cannot be fetched (offline, or a stale portal page after a
 * redeploy), the error carries `code = "PDF_ENGINE_UNAVAILABLE"` so the UI
 * can say "couldn't load the PDF renderer" instead of blaming the PDF.
 */
let enginePromise = null;

function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      let pdfjs, PdfWorker;
      try {
        [pdfjs, { default: PdfWorker }] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline"),
        ]);
      } catch (cause) {
        // Forget the failure so the next click retries rather than being
        // stuck with a rejected promise for the life of the page.
        enginePromise = null;
        const err = new Error("PDF renderer could not be loaded");
        err.code = "PDF_ENGINE_UNAVAILABLE";
        err.cause = cause;
        throw err;
      }
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
      return pdfjs;
    })();
  }
  return enginePromise;
}

/**
 * Render a PDF (as a data: URL) to JPEG data URLs, one per page.
 * Pages are rendered at up to `targetWidth` px wide (capped at 3x natural
 * scale) — sharp enough to zoom into text, small enough to keep the quote
 * blob saveable. Page count is capped so a 60-page drawing set can't blow
 * out storage; the caller is told the true page count to warn about it.
 */
export async function pdfToJpegPages(dataURL, { maxPages = 8, targetWidth = 1600, quality = 0.82 } = {}) {
  const pdfjs = await loadEngine();
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
