// The Estimates 3D viewer: Three.js (pinned in package.json) + the viewer in
// portal/estimates-3d/main.js, built as ONE self-contained IIFE that defines
// window.BomaThree. Built after the main app (emptyOutDir:false) into
// dist/assets/estimates-3d.js with a fixed name: the hosted portal loads it
// lazily from location.origin + "/assets/estimates-3d.js" the first time a
// 3D view is opened; the standalone/offline copies embed it (see
// scripts/assemble-portal.mjs). No CDN, no runtime network dependency.
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: { entry: "portal/estimates-3d/main.js", name: "BomaThree", formats: ["iife"], fileName: () => "assets/estimates-3d.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
    minify: true,
    sourcemap: false,
  },
});
