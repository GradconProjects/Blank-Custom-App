#!/usr/bin/env node
/**
 * Runs as a postbuild step (see package.json's "build" script) — folds the
 * just-built Quotes app (dist/index.html + its JS/CSS bundle) and the two
 * self-contained vanilla-JS tools (portal/estimates-app.html, portal/
 * cost-planner.html) into portal/portal-shell.html (the login + tab-
 * switching shell), then overwrites dist/index.html with the result. Vercel
 * serves whatever ends up in dist/, so this makes the single deployed URL
 * the full combined portal (login → Cost Planner / Quotes / Estimates tabs)
 * instead of just the bare Quotes SPA vite build produces on its own.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");
const shellPath = path.join(root, "portal", "portal-shell.html");
const estimatesPath = path.join(root, "portal", "estimates-app.html");
const costPlannerPath = path.join(root, "portal", "cost-planner.html");
const ratesLibraryPath = path.join(root, "portal", "rates-library.html");
const outPath = path.join(distDir, "index.html");

// --- Inline the built React app (Quotes) into one self-contained document ---
let quotesHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
const assetsDir = path.join(distDir, "assets");
const cssFile = fs.readdirSync(assetsDir).find((f) => f.endsWith(".css"));
// The ENTRY bundle is whichever file vite's index.html actually loads — never
// "the first .js in assets/": a lazily-loaded chunk (see below) sits in the
// same folder and picking that would inline the wrong file without a word.
const entryMatch = quotesHtml.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) throw new Error("could not find the entry <script src=\"/assets/…\"> in dist/index.html");
const jsFile = entryMatch[1];
const css = fs.readFileSync(path.join(assetsDir, cssFile), "utf8");
let js = fs.readFileSync(path.join(assetsDir, jsFile), "utf8");

/* --- Lazily-loaded chunks ---------------------------------------------------
 * Any other .js in assets/ is a chunk the entry pulls in on demand with a
 * dynamic import() (today: the PDF renderer, lib/pdfToImages.js). Vite emits
 * that as `import("./chunk-hash.js")`, resolved against the importing module's
 * URL — which, once this bundle is inlined and run from a blob: URL inside the
 * portal, is a blob: URL that a relative path cannot resolve against
 * (measured: "Failed to resolve module specifier"). `location.origin` inside
 * that iframe IS the real site origin (blob: URLs inherit their creator's), so
 * an absolute `origin + "/assets/chunk-hash.js"` loads fine, and Vercel serves
 * dist/assets/ as-is. The chunk file stays where vite put it.
 *
 * Every step is asserted so a build can only ever succeed with a working lazy
 * path — never with a silently broken one:
 *   - a chunk that itself imports another module could not run from a URL its
 *     imports don't resolve against, so it must be self-contained;
 *   - the entry must reference each chunk exactly once, as the literal
 *     `import("./<file>")` this rewrite targets (vite.config.js turns the
 *     preload helper off precisely so it takes that plain form). */
/* Modes (environment variables, all optional — see scripts/build-download.mjs):
 *   PORTAL_STANDALONE=1  the output is ONE file with nothing to fetch: lazy
 *                        chunks are embedded (base64) and served to import()
 *                        from a blob: URL made on demand — the downloadable
 *                        copy, which runs from file:// where "/assets" is
 *                        meaningless.
 *   PORTAL_OFFLINE=1     the vanilla apps' cloud constants are blanked so the
 *                        copy never talks to Supabase (Quotes is built with
 *                        the VITE_SUPABASE_* vars empty for the same effect,
 *                        and that is asserted below).
 *   PORTAL_OUT=<path>    where to write (default dist/index.html).
 *   PORTAL_STAMP_SUFFIX  appended to the build stamp, e.g. " · download". */
const STANDALONE = process.env.PORTAL_STANDALONE === "1";
const OFFLINE = process.env.PORTAL_OFFLINE === "1";
const outPathFinal = process.env.PORTAL_OUT ? path.resolve(process.env.PORTAL_OUT) : outPath;

// The Estimates 3D viewer bundle (vite.3d.config.js) is NOT a Quotes chunk:
// the Estimates document loads it itself — from /assets on the hosted portal,
// embedded (base64 → blob: URL) in the standalone/offline copies.
const THREE_BUNDLE = "estimates-3d.js";
const threeBundlePath = path.join(assetsDir, THREE_BUNDLE);
if (!fs.existsSync(threeBundlePath)) throw new Error(`dist/assets/${THREE_BUNDLE} is missing — run "vite build --config vite.3d.config.js" after the main build`);
const threeBundleSrc = fs.readFileSync(threeBundlePath, "utf8");
if (!/BomaThree/.test(threeBundleSrc)) throw new Error(`dist/assets/${THREE_BUNDLE} does not define BomaThree`);
const chunkFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js") && f !== jsFile && f !== THREE_BUNDLE);
const embeddedChunks = [];
for (const chunk of chunkFiles) {
  const chunkSrc = fs.readFileSync(path.join(assetsDir, chunk), "utf8");
  if (/(^|[;\s}])import\s*["'][^"']+["']|\bfrom\s*["']\.\/[^"']+["']/.test(chunkSrc)) {
    throw new Error(`chunk ${chunk} imports another module — it can't be loaded from an absolute URL on its own`);
  }
  const literal = `import("./${chunk}")`;
  const occurrences = js.split(literal).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected exactly one ${literal} in ${jsFile}, found ${occurrences} — the lazy-load rewrite would be wrong`);
  }
  if (STANDALONE) {
    js = js.replace(literal, () => `import(/* @vite-ignore */ window.__bomaChunkUrl(${JSON.stringify(chunk)}))`);
    embeddedChunks.push({ chunk, b64: Buffer.from(chunkSrc, "utf8").toString("base64") });
    console.log(`Lazy chunk ${chunk} (${(chunkSrc.length / 1024).toFixed(0)} KB) embedded for the standalone copy`);
  } else {
    js = js.replace(literal, () => `import(/* @vite-ignore */ location.origin + "/assets/${chunk}")`);
    console.log(`Lazy chunk kept at /assets/${chunk} (${(chunkSrc.length / 1024).toFixed(0)} KB), import rewritten to an absolute URL`);
  }
}
// The project's own cloud URL, taken from the Estimates app's constant — the
// one string that must not survive an offline build anywhere. (The
// supabase-js library inside the Quotes bundle mentions "supabase.co" in its
// own code, so the domain alone is no test.)
const projectUrlMatch = fs.readFileSync(estimatesPath, "utf8").match(/const SUPABASE_URL = "(https:\/\/[^"]+)";/);
const PROJECT_URL = projectUrlMatch ? projectUrlMatch[1] : null;
if (OFFLINE && PROJECT_URL && js.includes(PROJECT_URL)) {
  throw new Error("PORTAL_OFFLINE=1 but the Quotes bundle still carries the project's Supabase URL — build it with .env.local out of the way");
}

// The bundle can contain a literal "</script" substring inside a string/regex
// literal — embedded raw inside a real <script> tag, the HTML parser (not
// the JS parser) treats that as the tag's actual close, truncating the
// script and spilling the rest as visible text. `\/` is a no-op escape
// inside a JS string/regex literal, so this is semantically identical JS
// but can't prematurely close the tag.
js = js.replace(/<\/script/gi, "<\\/script");

// Replacer FUNCTIONS, not template-literal strings: String.replace() treats
// $&, $`, $', $$, $<n> as special patterns *inside a string replacement* —
// with hundreds of KB of minified JS interpolated in, a coincidental "$"
// followed by a backtick/quote/digit/& is near-guaranteed, silently
// splicing fragments of the surrounding document into the bundle. A
// function replacer returns its value literally, with no substitution.
// Standalone: the chunk payloads and the helper that turns one into a blob:
// module URL go in BEFORE the module script, so they exist when it runs.
// A blob: module import works from any document, file:// included.
const chunkPrelude = embeddedChunks.length
  ? embeddedChunks.map(({ chunk, b64 }) => `<script type="text/plain" id="boma-chunk-${chunk}">${b64}</script>`).join("\n") +
    `\n<script>window.__bomaChunkUrl=function(n){var c=window.__bomaChunkUrls=window.__bomaChunkUrls||{};if(c[n])return c[n];var raw=atob(document.getElementById("boma-chunk-"+n).textContent.trim());var b=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return c[n]=URL.createObjectURL(new Blob([b],{type:"text/javascript"}));};</script>\n`
  : "";
quotesHtml = quotesHtml
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => `${chunkPrelude}<script type="module">${js}</script>`);

// Positive check: confirm both tags were actually replaced with inlined
// content (not just that "/assets" is absent — the bundle can coincidentally
// contain that substring as inert string data inside unrelated dead code).
const headStart = quotesHtml.slice(0, 300 + chunkPrelude.length);
if (!/<script type="module">\s*\S/.test(headStart)) {
  throw new Error("script tag doesn't look inlined — check manually:\n" + headStart.slice(0, 300));
}
if (!quotesHtml.includes(`<style>${css.slice(0, 40)}`)) {
  throw new Error("style tag doesn't look inlined — css not found where expected");
}

// --- Estimates and Cost Planner are already self-contained, embed verbatim ---
let estimatesHtml = fs.readFileSync(estimatesPath, "utf8");
// The Estimates app keeps its pure, Node-testable modules in sibling files
// (estimates-schema.js: schema version, migration, raw backup). They are
// inlined here so the app stays ONE self-contained document that runs from
// a blob: URL. Asserted: a missing inline would ship an app that throws on
// its first function call.
{
  const inlineTag = /<script src="estimates-schema\.js"><\/script>/;
  if (!inlineTag.test(estimatesHtml)) throw new Error("estimates-app.html no longer loads estimates-schema.js — inline step out of date");
  const schemaSrc = fs.readFileSync(path.join(root, "portal", "estimates-schema.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  estimatesHtml = estimatesHtml.replace(inlineTag, () => `<script>${schemaSrc}</script>`);
  // estimates-orders.js: procurement rounding, order schedule, pour schedule,
  // reconciliation — same pure-module contract, same inline step.
  const ordersTag = /<script src="estimates-orders\.js"><\/script>/;
  if (!ordersTag.test(estimatesHtml)) throw new Error("estimates-app.html no longer loads estimates-orders.js — inline step out of date");
  const ordersSrc = fs.readFileSync(path.join(root, "portal", "estimates-orders.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  estimatesHtml = estimatesHtml.replace(ordersTag, () => `<script>${ordersSrc}</script>`);
  estimatesHtml = estimatesHtml.replaceAll("__BUILD_STAMP__", buildStamp() + (process.env.PORTAL_STAMP_SUFFIX || ""));
  // 3D viewer bundle: the hosted portal fetches /assets/estimates-3d.js on
  // demand (nothing embedded, the page stays small); a standalone copy has
  // no /assets to fetch from, so the bundle rides inside the document as
  // base64 and becomes a blob: URL the first time a 3D view opens.
  const threeTag = "<!-- __BOMA_3D_BUNDLE__ -->";
  if (!estimatesHtml.includes(threeTag)) throw new Error("estimates-app.html has no __BOMA_3D_BUNDLE__ placeholder — 3D embed step out of date");
  if (STANDALONE) {
    const b64 = Buffer.from(threeBundleSrc, "utf8").toString("base64");
    estimatesHtml = estimatesHtml.replace(threeTag, () => `<script type="text/plain" id="boma-3d-bundle">${b64}</script>`);
    console.log(`3D viewer bundle (${(threeBundleSrc.length / 1024).toFixed(0)} KB) embedded in the Estimates app for the standalone copy`);
  } else {
    estimatesHtml = estimatesHtml.replace(threeTag, () => "");
    console.log(`3D viewer bundle kept at /assets/${THREE_BUNDLE} (${(threeBundleSrc.length / 1024).toFixed(0)} KB), loaded on demand`);
  }
  console.log(`Inlined portal/estimates-schema.js (${(schemaSrc.length / 1024).toFixed(0)} KB) and portal/estimates-orders.js (${(ordersSrc.length / 1024).toFixed(0)} KB) into the Estimates app`);
}
let costPlannerHtml = fs.readFileSync(costPlannerPath, "utf8");
let ratesLibraryHtml = fs.readFileSync(ratesLibraryPath, "utf8");
if (OFFLINE) {
  // The vanilla apps carry their cloud constants inline. Blank them so the
  // offline copy never reaches out; each app already treats a failed fetch
  // as "use what is stored locally". Asserted so a renamed constant cannot
  // ship a copy that quietly still syncs.
  const blank = (html, name) => {
    const re = /const SUPABASE_(URL|ANON_KEY) = "[^"]*";/g;
    const n = (html.match(re) || []).length;
    if (n === 0) return html;
    const out = html.replace(re, (m, which) => `const SUPABASE_${which} = "";`);
    console.log(`Offline: blanked ${n} cloud constant(s) in ${name}`);
    return out;
  };
  estimatesHtml = blank(estimatesHtml, "estimates-app.html");
  costPlannerHtml = blank(costPlannerHtml, "cost-planner.html");
  ratesLibraryHtml = blank(ratesLibraryHtml, "rates-library.html");
  for (const [name, html] of [["estimates", estimatesHtml], ["cost-planner", costPlannerHtml], ["rates-library", ratesLibraryHtml]]) {
    if (PROJECT_URL && html.includes(PROJECT_URL)) throw new Error(`offline copy: ${name} still references the project's Supabase URL`);
  }
}

const quotesB64 = Buffer.from(quotesHtml, "utf8").toString("base64");
const estimatesB64 = Buffer.from(estimatesHtml, "utf8").toString("base64");
const costPlannerB64 = Buffer.from(costPlannerHtml, "utf8").toString("base64");
const ratesLibraryB64 = Buffer.from(ratesLibraryHtml, "utf8").toString("base64");

/* A visible build stamp. Without one, "am I on the latest version?" is
 * unanswerable from the browser — the portal is one 5 MB HTML file whose apps
 * are base64 payloads, so nothing on screen reveals which build is running and
 * a stale tab looks exactly like a fresh one. Vercel exposes the commit it
 * built from; locally, fall back to asking git. */
function buildStamp() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7)
    || (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "local"; } })();
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
const stamp = buildStamp() + (process.env.PORTAL_STAMP_SUFFIX || "");

let shell = fs.readFileSync(shellPath, "utf8");
shell = shell
  .replace("__QUOTES_B64__", quotesB64)
  .replace("__ESTIMATES_B64__", estimatesB64)
  .replace("__COSTPLANNER_B64__", costPlannerB64)
  .replace("__RATESLIBRARY_B64__", ratesLibraryB64)
  .replaceAll("__BUILD_STAMP__", stamp);

fs.mkdirSync(path.dirname(outPathFinal), { recursive: true });
fs.writeFileSync(outPathFinal, shell);
console.log("Build stamp:", stamp);
console.log("Assembled combined portal at", outPathFinal, "-", (fs.statSync(outPathFinal).size / 1024 / 1024).toFixed(2), "MB");
