import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // The Quotes app is inlined into one HTML document and run from a blob:
    // URL inside the portal, so Vite's preload helper (which resolves chunk
    // URLs relative to the module) can't work there. With it off, a dynamic
    // import() is emitted as a plain `import("./chunk.js")` that
    // scripts/assemble-portal.mjs rewrites to an absolute URL. Only
    // lib/pdfToImages.js uses a dynamic import today.
    modulePreload: false,
  },
});
