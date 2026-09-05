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
import { transformSync } from "esbuild";
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

// --- Strip the shell's own comments and minify its CSS ----------------------
// The <style> block and the HTML comments were still shipping verbatim, which
// meant the notes explaining the meter, the owner unlock and the lock screen
// could be read off the deployed page even with the script minified.
{
  const styleOpen = shell.indexOf("<style>");
  const styleClose = shell.indexOf("</style>", styleOpen);
  if (styleOpen !== -1 && styleClose !== -1) {
    const css = shell.slice(styleOpen + "<style>".length, styleClose);
    const out = transformSync(css, { loader: "css", minify: true }).code;
    shell = shell.slice(0, styleOpen + "<style>".length) + out + shell.slice(styleClose);
  }

  // HTML comments, but ONLY before the base64 payload scripts — those are
  // opaque data and must not be touched.
  const payloadAt = shell.indexOf('<script id="quotes-app-b64"');
  const cut = payloadAt === -1 ? shell.length : payloadAt;
  shell = shell.slice(0, cut).replace(/<!--[\s\S]*?-->/g, "") + shell.slice(cut);
}

// --- Minify the shell's own inline script -----------------------------------
// The four apps are already minified by their own builds; the shell was the
// one part still shipping as commented, readable source, which meant the
// whole trial-meter client — and the shape of the owner-key check — could be
// read straight out of View Source.
//
// Be clear about what this buys: it is FRICTION, not protection. Minified JS
// is still JS, and anyone determined can pretty-print it in seconds. The only
// real fix is to stop serving the app to visitors who haven't been granted a
// session (see CLAUDE.md -> "Trial meter"). What this does do is stop the
// portal reading as copy-paste-ready source to a casual look, and it strips
// the comments that would otherwise explain the meter to whoever opens it.
{
  const open = shell.indexOf("<script>\n(function(){");
  if (open === -1) throw new Error("shell script not found — did the <script> wrapper change?");
  const bodyStart = open + "<script>".length;
  const close = shell.indexOf("</script>", bodyStart);
  if (close === -1) throw new Error("shell script has no closing tag");

  const original = shell.slice(bodyStart, close);
  const { code } = transformSync(original, {
    minify: true,
    // Keep it ES2019 so the minifier doesn't emit syntax older Safari chokes
    // on — this file is the entry point, so a parse error here is a blank page.
    target: "es2019",
    legalComments: "none",
  });
  // Same guard as the app bundles below: a literal "</script" inside a string
  // would close the tag early and spill the rest of the file as visible text.
  const safe = code.replace(/<\/script/gi, "<\\/script");
  shell = shell.slice(0, bodyStart) + "\n" + safe + "\n" + shell.slice(close);

  const saved = original.length - safe.length;
  console.log(
    `Shell script minified: ${(original.length / 1024).toFixed(1)} kB -> ` +
    `${(safe.length / 1024).toFixed(1)} kB (${(saved / 1024).toFixed(1)} kB of source and comments removed)`
  );
}
shell = shell
  .replace("__QUOTES_B64__", quotesB64)
  .replace("__ESTIMATES_B64__", estimatesB64)
  .replace("__COSTPLANNER_B64__", costPlannerB64)
  .replace("__RATESLIBRARY_B64__", ratesLibraryB64);

fs.writeFileSync(outPath, shell);
console.log("Assembled combined portal at", outPath, "-", (fs.statSync(outPath).size / 1024 / 1024).toFixed(2), "MB");
