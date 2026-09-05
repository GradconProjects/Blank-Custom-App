/**
 * Regression checks for the server-side trial meter (api/trial.js).
 *
 * Runs the real handler against a stand-in PostgREST held in memory, so the
 * rules can be checked in plain Node with no Supabase project, no network and
 * no service-role key. `npm run verify:trial`.
 *
 * What's worth keeping honest here isn't the arithmetic so much as the
 * adversarial cases: a forged cookie must not be accepted, a capped network
 * must not get a fresh trial by clearing cookies, and a database outage must
 * fail CLOSED. Treat a red run exactly like a red `npm run verify`.
 */
import http from "node:http";
import handler, { resolveTrial } from "../api/trial.js";

// ---- fake PostgREST -------------------------------------------------------
const rows = new Map();
let seq = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const q = url.searchParams;
  let body = "";
  for await (const c of req) body += c;

  const all = [...rows.values()];
  const eq = (p) => (p || "").replace(/^eq\./, "");

  if (req.method === "GET") {
    let out = all;
    if (q.get("id")) out = out.filter((r) => r.id === eq(q.get("id")));
    if (q.get("ip_hash")) out = out.filter((r) => r.ip_hash === eq(q.get("ip_hash")));
    if (q.get("created_at")) {
      const since = q.get("created_at").replace(/^gte\./, "");
      out = out.filter((r) => r.created_at >= since);
    }
    if (q.get("order")) out = [...out].sort((a, b) => b.sessions_used - a.sessions_used || b.ms_used - a.ms_used);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
    return;
  }
  if (req.method === "POST") {
    const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
    const row = { id, sessions_used: 0, ms_used: 0, current_started_at: null,
                  current_expires_at: null, created_at: new Date().toISOString(),
                  last_seen_at: new Date().toISOString(), ...JSON.parse(body) };
    rows.set(id, row);
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify([row]));
    return;
  }
  if (req.method === "PATCH") {
    const id = eq(q.get("id"));
    const row = { ...rows.get(id), ...JSON.parse(body) };
    rows.set(id, row);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([row]));
    return;
  }
  res.writeHead(405).end();
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.TRIAL_SECRET = "test-secret-please-be-long";
process.env.TRIAL_OWNER_KEY = "5120";

// ---- harness --------------------------------------------------------------
let pass = 0, fail = 0;
const ok = (l, c) => { console.log((c ? "  ok  " : " FAIL ") + l); c ? pass++ : fail++; };

async function call({ cookies = {}, ip = "203.0.113.5", body = {} } = {}) {
  const req = {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body,
  };
  let status = 0, json = null, setCookie = [];
  const res = {
    setHeader: (k, v) => { if (k === "Set-Cookie") setCookie = v; },
    status(s) { status = s; return this; },
    json(j) { json = j; return this; },
  };
  await handler(req, res);
  const jar = {};
  for (const c of setCookie) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return { status, json, jar, setCookie };
}

// ---- pure rule checks -----------------------------------------------------
const HOUR = 3600_000;
const blank = { sessions_used: 0, ms_used: 0, current_started_at: null, current_expires_at: null };
const now = Date.now();

let r = resolveTrial(blank, now);
ok("fresh visitor starts session 1, one hour long",
  r.view.state === "active" && r.view.sessionsUsed === 1 && Math.abs(r.view.msLeftSession - HOUR) < 50);

r = resolveTrial({ ...blank, sessions_used: 1, current_started_at: new Date(now - 10 * 60000).toISOString(),
                   current_expires_at: new Date(now + 50 * 60000).toISOString() }, now);
ok("a reload mid-session resumes it, doesn't spend another",
  r.view.sessionsUsed === 1 && !r.dirty && Math.abs(r.view.msLeftSession - 50 * 60000) < 50);

r = resolveTrial({ ...blank, sessions_used: 1, current_started_at: new Date(now - 2 * HOUR).toISOString(),
                   current_expires_at: new Date(now - HOUR).toISOString() }, now);
ok("an expired session banks a full hour and rolls into session 2",
  r.next.sessions_used === 2 && r.next.ms_used === HOUR && r.view.state === "active");

r = resolveTrial({ ...blank, sessions_used: 4, ms_used: 4 * HOUR }, now);
ok("session 5 is allowed and capped to the last hour",
  r.view.state === "active" && r.view.sessionsUsed === 5 && Math.abs(r.view.msLeftSession - HOUR) < 50);

r = resolveTrial({ ...blank, sessions_used: 5, ms_used: 5 * HOUR }, now);
ok("a spent trial is locked", r.view.state === "locked" && r.view.msLeftTotal === 0);

r = resolveTrial({ ...blank, sessions_used: 2, ms_used: 5 * HOUR }, now);
ok("five hours locks even with sessions left", r.view.state === "locked");

r = resolveTrial({ ...blank, sessions_used: 3, ms_used: 4.5 * HOUR }, now);
ok("the final session is trimmed to what's left of the five hours",
  Math.abs(r.view.msLeftSession - 0.5 * HOUR) < 50);

// ---- handler / identity checks -------------------------------------------
let a = await call();
ok("first request returns active and sets a visitor cookie",
  a.status === 200 && a.json.state === "active" && Boolean(a.jar.boma_v));
ok("visitor cookie is HttpOnly + Secure (scripts can't touch it)",
  a.setCookie[0].includes("HttpOnly") && a.setCookie[0].includes("Secure"));

const jar = { boma_v: a.jar.boma_v };
let b = await call({ cookies: jar });
ok("same cookie resumes the same session", b.json.sessionsUsed === 1 && b.json.state === "active");

// tamper with the signature
const forged = jar.boma_v.replace(/\.[^.]+$/, ".deadbeef");
let c = await call({ cookies: { boma_v: forged } });
ok("a forged cookie is rejected and treated as a new visitor", c.json.state === "active");
ok("...and it did NOT resurrect the tampered id", c.jar.boma_v !== forged);

// IP cap
rows.clear(); seq = 0;
const minted = [];
for (let i = 0; i < 5; i++) minted.push(await call({ ip: "198.51.100.9" }));
ok(`one network mints at most ${3} trials, then inherits`, rows.size === 3);

// exhaust the inherited one and prove a "fresh" visitor from that IP is locked
for (const row of rows.values()) { row.sessions_used = 5; row.ms_used = 5 * HOUR;
  row.current_started_at = null; row.current_expires_at = null; }
let d = await call({ ip: "198.51.100.9" });
ok("clearing cookies on a capped network inherits the spent trial, stays locked",
  d.json.state === "locked");

let e = await call({ ip: "192.0.2.77" });
ok("a genuinely different network still gets its own trial", e.json.state === "active");

// owner bypass
let o = await call({ body: { ownerKey: "5120" }, ip: "198.51.100.9" });
ok("owner key bypasses the meter", o.json.state === "owner");
ok("owner key is remembered by cookie", Boolean(o.jar.boma_owner));
let o2 = await call({ cookies: { boma_owner: o.jar.boma_owner }, ip: "198.51.100.9" });
ok("owner cookie alone keeps the bypass", o2.json.state === "owner");
let o3 = await call({ body: { ownerKey: "5121" }, ip: "192.0.2.99" });
ok("a wrong owner key does NOT bypass", o3.json.state !== "owner");

// The key must work on a deployment that hasn't set TRIAL_OWNER_KEY yet,
// otherwise the owner is locked out of their own demo.
const savedKey = process.env.TRIAL_OWNER_KEY;
delete process.env.TRIAL_OWNER_KEY;
let d1 = await call({ body: { ownerKey: "2580" }, ip: "192.0.2.150" });
ok("2580 unlocks even with TRIAL_OWNER_KEY unset", d1.json.state === "owner");
let d2 = await call({ body: { ownerKey: " 2580 " }, ip: "192.0.2.151" });
ok("...and tolerates stray whitespace around it", d2.json.state === "owner");
let d3 = await call({ body: { ownerKey: "2581" }, ip: "192.0.2.152" });
ok("...but a near-miss still does not", d3.json.state !== "owner");
process.env.TRIAL_OWNER_KEY = savedKey;

// An env var, when set, must WIN over the built-in default.
process.env.TRIAL_OWNER_KEY = "seteinsteadofdefault";
let e1 = await call({ body: { ownerKey: "2580" }, ip: "192.0.2.160" });
ok("a configured TRIAL_OWNER_KEY overrides the default", e1.json.state !== "owner");
let e2 = await call({ body: { ownerKey: "seteinsteadofdefault" }, ip: "192.0.2.161" });
ok("...and the configured key works", e2.json.state === "owner");
process.env.TRIAL_OWNER_KEY = savedKey;

// unconfigured
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
let u = await call();
ok("unconfigured returns 503 with configured:false", u.status === 503 && u.json.configured === false);
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";

// db down
server.close();
let f = await call({ ip: "192.0.2.123" });
ok("a database failure fails CLOSED (502, not unlimited access)",
  f.status === 502 && f.json.state === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
if (!fail) console.log("All good.");
process.exit(fail ? 1 : 0);
