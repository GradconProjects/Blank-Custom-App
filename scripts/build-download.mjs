#!/usr/bin/env node
/**
 * Builds the DOWNLOADABLE copies of the portal — `npm run build:download`.
 *
 * Produces download/BOMA-Estimator-download.zip holding:
 *   BOMA-Estimator.html          the portal exactly as hosted, in one file:
 *                                   double-click to open, shares the same cloud
 *                                   database as the website (needs internet).
 *   BOMA-Estimator-offline.html  the same portal with every cloud link cut:
 *                                   everything is kept in the browser it is
 *                                   opened in. Works with no internet at all.
 *   README.txt                      what each file is and how to move quotes
 *                                   between them (Save to computer / Open .json).
 *   source.zip                      the source code at this exact commit.
 *
 * Each HTML is one self-contained file: the PDF renderer chunks the hosted
 * portal fetches from /assets are embedded here (PORTAL_STANDALONE=1), and the
 * portal shell loads its apps through srcdoc when opened from file://, where a
 * blob: iframe would have no storage (see portal-shell.html).
 *
 * Leaves dist/ as the ordinary hosted build afterwards, so running this never
 * changes what a following deploy would ship.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "download");
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
const sha = (() => { try { return execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch { return "local"; } })();

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

console.log("\n=== 1/4  Cloud-connected copy ===");
run("npx vite build"); run("npx vite build --config vite.3d.config.js");
run("node scripts/assemble-portal.mjs", { PORTAL_STANDALONE: "1", PORTAL_OUT: path.join(outDir, "BOMA-Estimator.html"), PORTAL_STAMP_SUFFIX: " · download" });

console.log("\n=== 2/4  Offline copy ===");
// Vite gives .env.local precedence over an EMPTY process variable, so the
// only dependable way to build without the cloud config is to take the file
// out of the way for this one build. Restored no matter what happens.
const envLocal = path.join(root, ".env.local");
const envAside = path.join(root, ".env.local.download-aside");
const hadEnv = fs.existsSync(envLocal);
if (hadEnv) fs.renameSync(envLocal, envAside);
try {
  run("npx vite build", { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" }); run("npx vite build --config vite.3d.config.js");
  run("node scripts/assemble-portal.mjs", { PORTAL_STANDALONE: "1", PORTAL_OFFLINE: "1", PORTAL_OUT: path.join(outDir, "BOMA-Estimator-offline.html"), PORTAL_STAMP_SUFFIX: " · offline copy" });
} finally {
  if (hadEnv) fs.renameSync(envAside, envLocal);
}

console.log("\n=== 3/4  Source + README ===");
run(`git archive --format=zip -o "${path.join(outDir, "source.zip")}" HEAD`);
fs.writeFileSync(path.join(outDir, "README.txt"), `BOMA ESTIMATES — downloadable copy (build ${sha})
=====================================================

Two ways to run it. Both are single files: double-click to open in Chrome or Edge.

BOMA-Estimator.html
  The portal exactly as hosted, in one file. It uses the SAME shared cloud
  database as the website, so projects, rates and versions are the ones the
  team sees. Needs an internet connection. Keep this file private: it
  connects to your database with the same publishable key the website uses.

BOMA-Estimator-offline.html
  The same portal with every cloud link removed. Everything is stored in the
  browser it is opened in (that browser, that computer) and it works with no
  internet at all. Good as a backup tool or on site.
  - Browser storage is limited (about 5 MB per browser). Quotes with many
    marked-up drawings can exceed it; the app tells you when a save fails.
  - Versions (the unlimited saves) need the cloud, so in this copy use
    "Save to computer" for your snapshots.
  - The portal's display fonts come from Google Fonts; with no internet the
    browser's standard fonts are used instead. Nothing else is fetched.

Moving quotes between copies, or into the website
  In any copy: open the project and click "Save to computer" — that writes a
  .boma-quote.json file. On the other copy (or the website): Dashboard →
  "Open .json". Estimates has its own Save/Load .json under Project Setup.

Login
  Same as the website (choose your name, enter your PIN).

source.zip
  The complete source code at this build. To run or rebuild it:
    npm install
    npm run dev           (development)
    npm run build:portal  (the hosted build in dist/)
    npm run build:download (these files)
`);

console.log("\n=== 4/4  Zip + restore the hosted build ===");
run(`cd "${outDir}" && zip -q -j BOMA-Estimator-download.zip BOMA-Estimator.html BOMA-Estimator-offline.html README.txt source.zip`);
run("npx vite build"); run("npx vite build --config vite.3d.config.js");
run("node scripts/assemble-portal.mjs");

for (const f of fs.readdirSync(outDir)) {
  console.log(`  ${f.padEnd(36)} ${(fs.statSync(path.join(outDir, f)).size / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`\nReady: ${path.join(outDir, "BOMA-Estimator-download.zip")}`);
