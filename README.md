# BOMA ESTIMATES

A concrete-subcontract estimating tool. A **Projects Dashboard** lists
every quote you've started, each with a live-computed total and a
portfolio-wide sum across all of them. Opening a project gives you the
usual workbook-style editor: pick a structural element (earthworks,
piling, footings, retention, slabs, suspended structure, pool, civil
works — folded under broad categories) from a dropdown, the full
material, reinforcement, formwork and labour catalog for that element
rolls out below it, fill in the quantities that apply, and everything
rolls up live into a quote — element total → section subtotal → category
subtotal → grand total → margin ladder with GST.

## Trial build

The deployed portal is gated: sign in with the access password, and you get
**5 sessions of 1 hour each — 5 hours in total**. The countdown runs in the
header, a session survives a page reload without being spent, and once the
allowance is gone the portal locks on a `GET FULL VERSION` screen. All of
that lives in `portal/portal-shell.html`; it is a per-browser demo limiter
rather than real auth (see `CLAUDE.md` → "Trial gate"). `npm run dev` serves
the ungated Quotes app for development.

## Running it

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`).

For a production build:

```bash
npm run build
npm run preview   # serves the built app locally to check it
```

## Editing with Claude Code

This project has a **`CLAUDE.md`** file at the root written specifically
so Claude Code (or any coding assistant) can safely make changes without
breaking the costing math — it documents the pricing rules, the
architecture, and a Node-runnable regression check (`npm run verify`)
that catches the kinds of mistakes that don't throw an error but do
produce a wrong quote. Point Claude Code at this folder and it'll pick
`CLAUDE.md` up automatically.

## Data persistence

By default, your projects, quotes and any rate edits are saved
automatically to your browser's local storage as you work — no login, no
server. That's **per-browser**: it won't sync between your desktop and
laptop, and it won't be visible to anyone else opening the app on a
different machine.

For shared access (e.g. your whole team seeing the same live projects),
set up the optional Supabase backend:

1. Create a Supabase project and run `supabase/migrations/0001_estimator_kv.sql`
   against it (paste into the SQL editor, or `supabase db push` with the CLI).
2. Copy `.env.example` to `.env.local` and fill in your project's URL and
   **anon/publishable** key (Project Settings → API) — never the
   secret/service_role key, which must never ship in client-side code.
3. Restart `npm run dev` (or redeploy). The app picks this up automatically —
   no code changes needed.

There's still no login — anyone with the URL and the anon key can read
and write every project. See `CLAUDE.md` → "Known limitations" before
deploying this publicly.

## Project layout

```
src/data/catalog.js         the material/labour catalog and element-type list — edit prices/products here
src/lib/costing.js           the costing formulas — read CLAUDE.md before touching this
src/lib/storage.js            persistence — Supabase when configured, localStorage otherwise
src/lib/projects.js            the multi-project index
src/lib/supabaseClient.js       Supabase client, configured from env vars only
src/components/                   UI, including components/Dashboard.jsx (the projects list)
src/App.jsx                         top-level page — switches between Dashboard and a project editor
scripts/verify.mjs                  run with `npm run verify` — regression checks for the costing engine
supabase/migrations/                 SQL schema for the optional Supabase backend
```
