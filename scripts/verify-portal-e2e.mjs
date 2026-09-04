/**
 * End-to-end browser check of the metered portal. Needs `npm run build:portal`
 * first (it drives dist/index.html) and playwright installed:
 *   npm i -D playwright && node scripts/verify-portal-e2e.mjs
 * Not part of `npm run verify` because of those two prerequisites.
 *
 * End-to-end: the BUILT portal served over HTTP, with a real /api/trial
 * running against an in-memory PostgREST stand-in. Proves the no-login boot,
 * the server-enforced lockout, and that clearing browser storage does not
 * hand back a fresh trial.
 */
import http from "node:http";
import fs from "node:fs";
import { chromium } from "playwright";
import handler from "../api/trial.js";

// ---- fake PostgREST -------------------------------------------------------
const rows = new Map();
let seq = 0;
const pg = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const q = url.searchParams;
  let body = ""; for await (const c of req) body += c;
  const eq = (p) => (p || "").replace(/^eq\./, "");
  const all = [...rows.values()];
  if (req.method === "GET") {
    let out = all;
    if (q.get("id")) out = out.filter((r) => r.id === eq(q.get("id")));
    if (q.get("ip_hash")) out = out.filter((r) => r.ip_hash === eq(q.get("ip_hash")));
    if (q.get("order")) out = [...out].sort((a, b) => b.sessions_used - a.sessions_used);
    return res.writeHead(200, {"content-type":"application/json"}).end(JSON.stringify(out));
  }
  if (req.method === "POST") {
    const id = `00000000-0000-4000-8000-${String(++seq).padStart(12,"0")}`;
    const row = { id, sessions_used:0, ms_used:0, current_started_at:null, current_expires_at:null,
                  created_at:new Date().toISOString(), last_seen_at:new Date().toISOString(), ...JSON.parse(body) };
    rows.set(id, row);
    return res.writeHead(201, {"content-type":"application/json"}).end(JSON.stringify([row]));
  }
  if (req.method === "PATCH") {
    const id = eq(q.get("id"));
    const row = { ...rows.get(id), ...JSON.parse(body) };
    rows.set(id, row);
    return res.writeHead(200, {"content-type":"application/json"}).end(JSON.stringify([row]));
  }
  res.writeHead(405).end();
});
await new Promise((r) => pg.listen(0, r));
process.env.SUPABASE_URL = `http://127.0.0.1:${pg.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TRIAL_SECRET = "e2e-secret-long-enough";
process.env.TRIAL_OWNER_KEY = "5120";

// ---- the portal + the real API -------------------------------------------
const html = fs.readFileSync(new URL("../dist/index.html", import.meta.url));
const site = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/trial")) {
    let raw = ""; for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : {};
    const shim = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(s) { res.statusCode = s; return this; },
      json(j) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(j)); return this; },
    };
    return handler(req, shim);
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
});
await new Promise((r) => site.listen(4322, r));
const URL_ = "http://localhost:4322/";

let pass = 0, fail = 0;
const ok = (l, c) => { console.log((c ? "  ok  " : " FAIL ") + l); c ? pass++ : fail++; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const S = "/tmp/claude-0/-home-user-Blank-Custom-App/d4af7d7e-bd02-5a5a-b636-d8a742d9b48e/scratchpad";

// --- 1. no login: land straight in the app ---
let ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
let page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
await page.goto(URL_);
await page.waitForSelector("#screen-dashboard.active", { timeout: 10000 });
ok("lands straight on the dashboard — no login, no password", true);
ok("no login screen exists in the DOM at all", await page.locator("#screen-login").count() === 0);
ok("no End session button", await page.locator("#logout-btn").count() === 0);
await page.waitForTimeout(1200);
ok("countdown pill is server-fed and running",
  /5\d:\d\d left · session 1\/5/.test((await page.textContent("#trial-pill-dash")).replace(/\s+/g," ")));
ok("server recorded exactly one visitor, one session", rows.size === 1 && [...rows.values()][0].sessions_used === 1);
await page.screenshot({ path: `${S}/shot2-boot.png` });

// --- 2. the cookie is out of reach of page scripts ---
ok("visitor cookie is invisible to document.cookie (HttpOnly)",
  !(await page.evaluate(() => document.cookie)).includes("boma_v"));

// --- 3. reload does not spend a session ---
await page.reload();
await page.waitForSelector("#screen-dashboard.active");
ok("reload resumes the session rather than spending another",
  [...rows.values()][0].sessions_used === 1);

// --- 4. wiping ALL browser storage does not reset the trial ---
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload();
await page.waitForSelector("#screen-dashboard.active");
ok("clearing localStorage does not reset the count (this is the whole point)",
  [...rows.values()][0].sessions_used === 1);

// --- 5. burn the trial server-side, confirm the wall ---
for (const r of rows.values()) { r.sessions_used = 5; r.ms_used = 5*3600_000; r.current_started_at = null; r.current_expires_at = null; }
await page.reload();
await page.waitForSelector("#screen-locked.active", { timeout: 10000 });
ok("a spent trial shows GET FULL VERSION",
  (await page.textContent(".lock-headline")).trim() === "GET FULL VERSION");
await page.screenshot({ path: `${S}/shot2-locked.png` });

// --- 6. a brand-new browser profile from the same IP inherits the spent trial ---
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
await page2.goto(URL_);
await page2.waitForSelector("#screen-dashboard.active", { timeout: 10000 });
ok("2nd fresh profile on this IP still gets a trial (within the per-IP cap)", true);
const ctx3 = await browser.newContext(); const page3 = await ctx3.newPage();
await page3.goto(URL_); await page3.waitForSelector("#screen-dashboard.active", { timeout: 10000 });
const ctx4 = await browser.newContext(); const page4 = await ctx4.newPage();
await page4.goto(URL_);
await page4.waitForSelector("#screen-locked.active", { timeout: 10000 });
ok("4th fresh profile is past the per-IP cap and inherits the SPENT trial → locked", true);
ok("server minted at most 3 trials for this network", rows.size === 3);

// --- 7. owner key bypasses ---
const ctx5 = await browser.newContext(); const page5 = await ctx5.newPage();
await page5.goto(URL_ + "?key=5120");
await page5.waitForSelector("#screen-dashboard.active", { timeout: 10000 });
await page5.waitForTimeout(600);
ok("owner key gets full access", (await page5.textContent("#trial-pill-dash")).includes("Full access"));
ok("owner key is scrubbed from the address bar", !page5.url().includes("key="));

console.log(errors.length ? "\nPAGE ERRORS:\n" + errors.join("\n") : "\nno page errors");
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); site.close(); pg.close();
process.exit(fail || errors.length ? 1 : 0);
