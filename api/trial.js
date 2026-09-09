/**
 * Vercel serverless function — the trial meter.
 *
 * The portal has no login screen and no password: a visitor lands and the
 * app opens straight away. What limits them is this endpoint. The browser
 * gets told how much trial it has left, but it never gets to DECIDE that —
 * the counters live in Supabase and are only ever written here.
 *
 * Why this exists at all: the previous version of the meter kept its counts
 * in localStorage, which any visitor resets from the browser's own UI in two
 * clicks. Anything the client can write, the client can rewrite.
 *
 * The rules (see also CLAUDE.md -> "Trial meter"):
 *   - TRIAL_MAX_SESSIONS (3) sessions, SESSION_MS (1 hour) each,
 *     TRIAL_MAX_MS (3 hours) in total. Whichever runs out first locks,
 *     and the only way back in is the PIN.
 *   - A session starts on the first request that finds no live one, so
 *     landing on the page IS starting a session. Reloading during a live
 *     session resumes it rather than spending another.
 *   - Time is charged from the session's own started_at, so closing the tab
 *     doesn't pause the clock.
 *
 * Identity, and its honest limits: a visitor is a signed HttpOnly cookie
 * (scripts can't read or forge it) plus a hash of their IP. Someone who
 * clears cookies or opens a private window looks new — that is unavoidable
 * without asking people to log in, which is exactly what we're not doing.
 * MAX_TRIALS_PER_IP is what stops that being free: once a network has minted
 * its quota of trials, the next "new" visitor from it inherits the most-used
 * existing row instead of getting a fresh five hours.
 *
 * Server-side environment variables required in the Vercel project
 * (Project -> Settings -> Environment Variables). NONE may carry the VITE_
 * prefix — that prefix tells Vite to inline the value into client code,
 * which for the service-role key would hand every visitor full admin access
 * to the database:
 *   SUPABASE_URL                 https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    the secret/service_role key (bypasses RLS;
 *                                trial_visitors has RLS on and no policies,
 *                                so this is the only way to reach it)
 *   TRIAL_SECRET                 any long random string — signs the visitor
 *                                cookie and hashes IPs
 *   TRIAL_OWNER_KEY              optional; the owner key. Defaults to
 *                                DEFAULT_OWNER_KEY below if unset. Entering
 *                                it marks the browser as yours and lifts
 *                                every limit, so you can always demo.
 */
import crypto from "node:crypto";

const SESSION_MS = 60 * 60 * 1000;
const TRIAL_MAX_SESSIONS = 3;
const TRIAL_MAX_MS = TRIAL_MAX_SESSIONS * SESSION_MS;

// How many separate trials one network may mint before newcomers from it
// start inheriting a spent one. Deliberately not 1: a real office, a
// university, or anyone behind carrier-grade NAT shares an address, and
// turning genuine second viewers away is worse than letting a determined
// person have three goes.
const MAX_TRIALS_PER_IP = 3;
const IP_WINDOW_DAYS = 30;

// The owner key, when TRIAL_OWNER_KEY isn't set. It lifts every limit on the
// browser that enters it — see the owner-bypass block in the handler.
//
// A hardcoded fallback is weaker than the env var: anyone who can read this
// file can read the key. That's fine while the repo is private and this is a
// portfolio demo, but set TRIAL_OWNER_KEY to something else the moment it
// isn't.
const DEFAULT_OWNER_KEY = "2580";

const VISITOR_COOKIE = "boma_v";
const OWNER_COOKIE = "boma_owner";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~13 months, the browser cap

// ---------------------------------------------------------------- helpers

const sign = (value, secret) =>
  crypto.createHmac("sha256", secret).update(value).digest("base64url");

/** Constant-time compare so a wrong signature can't be probed byte by byte. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readCookies(req) {
  const out = {};
  const raw = req.headers?.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookie = (name, value, { maxAge = COOKIE_MAX_AGE } = {}) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; ` +
  `HttpOnly; Secure; SameSite=Lax`;

/**
 * The visitor cookie is "<uuid>.<hmac>". Unsigned it would just be a number
 * a visitor could edit to a fresh one, which is the localStorage problem all
 * over again — signing means only this function can mint a valid id.
 */
function readVisitorId(cookies, secret) {
  const raw = cookies[VISITOR_COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return safeEqual(raw.slice(dot + 1), sign(id, secret)) ? id : null;
}

const visitorCookieValue = (id, secret) => `${id}.${sign(id, secret)}`;

/**
 * Vercel puts the real client address at the front of x-forwarded-for. It is
 * hashed rather than stored: this only ever answers "seen this network
 * before", so there's no reason to keep the address itself.
 */
function ipHashOf(req, secret) {
  const fwd = req.headers?.["x-forwarded-for"];
  const ip =
    (Array.isArray(fwd) ? fwd[0] : String(fwd || "")).split(",")[0].trim() ||
    req.headers?.["x-real-ip"] ||
    "unknown";
  return sign(`ip:${ip}`, secret);
}

// ------------------------------------------------------------ supabase i/o
// Plain PostgREST over fetch rather than @supabase/supabase-js: three
// queries don't justify pulling the client SDK into the function bundle.

function db(env) {
  const base = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/trial_visitors`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  const call = async (url, init) => {
    const res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
    if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  return {
    byId: async (id) =>
      (await call(`${base}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0] || null,

    /** Rows this network has minted inside the window, most-spent first. */
    byIp: (ipHash, sinceIso) =>
      call(
        `${base}?ip_hash=eq.${encodeURIComponent(ipHash)}` +
          `&created_at=gte.${encodeURIComponent(sinceIso)}` +
          `&select=*&order=sessions_used.desc,ms_used.desc`
      ),

    insert: async (row) =>
      (await call(base, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      }))?.[0],

    update: async (id, patch) =>
      (await call(`${base}?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      }))?.[0],
  };
}

// ------------------------------------------------------------- meter rules

const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * Advance a stored row to `now`: bank a session that has finished, then
 * start a new one if the trial still has room. Pure — it returns the next
 * row plus the numbers the browser needs, and the caller decides whether
 * anything actually needs writing.
 */
export function resolveTrial(row, now) {
  let sessionsUsed = row.sessions_used || 0;
  let msUsed = Number(row.ms_used || 0);
  let startedAt = ms(row.current_started_at);
  let expiresAt = ms(row.current_expires_at);
  let dirty = false;

  // A session that has run past its expiry is over — bank the span it was
  // granted (not "now minus started", or a visitor who disappears for a week
  // would be charged the week).
  if (startedAt && expiresAt && now >= expiresAt) {
    msUsed += Math.max(0, expiresAt - startedAt);
    startedAt = expiresAt = null;
    dirty = true;
  }

  const exhausted = () => sessionsUsed >= TRIAL_MAX_SESSIONS || msUsed >= TRIAL_MAX_MS;

  // No live session and room left: landing on the page starts the next one.
  if (!startedAt && !exhausted()) {
    const span = Math.min(SESSION_MS, TRIAL_MAX_MS - msUsed);
    sessionsUsed += 1;
    startedAt = now;
    expiresAt = now + span;
    dirty = true;
  }

  const live = Boolean(startedAt && expiresAt && now < expiresAt);
  const spentNow = msUsed + (live ? now - startedAt : 0);

  return {
    dirty,
    next: {
      sessions_used: sessionsUsed,
      ms_used: msUsed,
      current_started_at: startedAt ? new Date(startedAt).toISOString() : null,
      current_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    },
    view: {
      state: live ? "active" : "locked",
      sessionsUsed: Math.min(sessionsUsed, TRIAL_MAX_SESSIONS),
      maxSessions: TRIAL_MAX_SESSIONS,
      msLeftSession: live ? expiresAt - now : 0,
      msLeftTotal: Math.max(0, TRIAL_MAX_MS - spentNow),
      msUsedTotal: Math.min(spentNow, TRIAL_MAX_MS),
      sessionMs: SESSION_MS,
      maxTotalMs: TRIAL_MAX_MS,
    },
  };
}

// ---------------------------------------------------------------- handler

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const env = process.env;
  const secret = env.TRIAL_SECRET;

  // Not configured (a fresh clone, a preview deploy without env vars): say so
  // plainly rather than half-metering. The shell treats this as "no server
  // meter available" and falls back to its local one — see portal-shell.html.
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !secret) {
    res.status(503).json({
      error:
        "Trial meter isn't configured — set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY " +
        "and TRIAL_SECRET in this Vercel project's Environment Variables " +
        "(server-side only, no VITE_ prefix).",
      configured: false,
    });
    return;
  }

  const cookies = readCookies(req);
  const setCookies = [];

  // --- owner bypass: your own key, so you can always show the thing off ---
  const ownerKey = (req.body || {}).ownerKey;
  const expectedOwnerKey = env.TRIAL_OWNER_KEY || DEFAULT_OWNER_KEY;
  const isOwner =
    safeEqual(cookies[OWNER_COOKIE] || "", sign("owner", secret)) ||
    (typeof ownerKey === "string" && safeEqual(ownerKey.trim(), expectedOwnerKey));

  if (isOwner) {
    setCookies.push(cookie(OWNER_COOKIE, sign("owner", secret)));
    res.setHeader("Set-Cookie", setCookies);
    res.status(200).json({
      configured: true,
      state: "owner",
      sessionsUsed: 0,
      maxSessions: TRIAL_MAX_SESSIONS,
      msLeftSession: SESSION_MS,
      msLeftTotal: TRIAL_MAX_MS,
      msUsedTotal: 0,
      sessionMs: SESSION_MS,
      maxTotalMs: TRIAL_MAX_MS,
    });
    return;
  }

  try {
    const store = db(env);
    const now = Date.now();
    const ipHash = ipHashOf(req, secret);

    let row = null;
    const cookieId = readVisitorId(cookies, secret);
    if (cookieId) row = await store.byId(cookieId);

    if (!row) {
      // First contact, or a cleared/forged cookie. Before minting a fresh
      // five hours, check what this network has already had: past the cap,
      // the newcomer inherits the most-spent existing trial. This is the
      // only thing standing between "no login" and "unlimited free resets".
      const since = new Date(now - IP_WINDOW_DAYS * 86400_000).toISOString();
      const existing = (await store.byIp(ipHash, since)) || [];
      row =
        existing.length >= MAX_TRIALS_PER_IP
          ? existing[0]
          : await store.insert({ ip_hash: ipHash });
    }

    const { dirty, next, view } = resolveTrial(row, now);
    if (dirty) await store.update(row.id, { ...next, last_seen_at: new Date(now).toISOString() });

    setCookies.push(cookie(VISITOR_COOKIE, visitorCookieValue(row.id, secret)));
    res.setHeader("Set-Cookie", setCookies);
    res.status(200).json({ configured: true, ...view });
  } catch (err) {
    // Never fail open into "unlimited": a meter that stops metering the
    // moment the database hiccups isn't a meter. The shell shows its own
    // local count while this is down.
    console.error("trial meter error:", err);
    res.status(502).json({ error: "Trial meter is temporarily unavailable.", configured: true });
  }
}
