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
const jsFile = fs.readdirSync(assetsDir).find((f) => f.endsWith(".js"));
const css = fs.readFileSync(path.join(assetsDir, cssFile), "utf8");
let js = fs.readFileSync(path.join(assetsDir, jsFile), "utf8");

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
quotesHtml = quotesHtml
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => `<script type="module">${js}</script>`);

// Positive check: confirm both tags were actually replaced with inlined
// content (not just that "/assets" is absent — the bundle can coincidentally
// contain that substring as inert string data inside unrelated dead code).
const headStart = quotesHtml.slice(0, 300);
if (!/<script type="module">\s*\S/.test(headStart)) {
  throw new Error("script tag doesn't look inlined — check manually:\n" + headStart);
}
if (!quotesHtml.includes(`<style>${css.slice(0, 40)}`)) {
  throw new Error("style tag doesn't look inlined — css not found where expected");
}

// --- Estimates and Cost Planner are already self-contained, embed verbatim ---
const estimatesHtml = fs.readFileSync(estimatesPath, "utf8");
const costPlannerHtml = fs.readFileSync(costPlannerPath, "utf8");
const ratesLibraryHtml = fs.readFileSync(ratesLibraryPath, "utf8");

const quotesB64 = Buffer.from(quotesHtml, "utf8").toString("base64");
const estimatesB64 = Buffer.from(estimatesHtml, "utf8").toString("base64");
const costPlannerB64 = Buffer.from(costPlannerHtml, "utf8").toString("base64");
const ratesLibraryB64 = Buffer.from(ratesLibraryHtml, "utf8").toString("base64");

let shell = fs.readFileSync(shellPath, "utf8");
shell = shell
  .replace("__QUOTES_B64__", quotesB64)
  .replace("__ESTIMATES_B64__", estimatesB64)
  .replace("__COSTPLANNER_B64__", costPlannerB64)
  .replace("__RATESLIBRARY_B64__", ratesLibraryB64);

fs.writeFileSync(outPath, shell);
console.log("Assembled combined portal at", outPath, "-", (fs.statSync(outPath).size / 1024 / 1024).toFixed(2), "MB");
