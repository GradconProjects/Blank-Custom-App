# BOMA ESTIMATES — instructions for Claude Code

This is BOMA ESTIMATES, a concrete-subcontract estimating tool: pick a structural
element from a dropdown, the entire material/reo/formwork/labour catalog
for that element rolls out below it, fill in quantities, and everything
rolls up live into a quote (element → section → grand total → margin
ladder). It's a React + Vite + Tailwind app, built to replace an Excel
workbook that did the same thing with formulas.

Read this whole file before changing anything in `src/lib/costing.js` or
`src/data/catalog.js` — the costing rules below aren't arbitrary, they're
what a real Excel workbook got wrong once and had corrected. Breaking one
of them silently produces a wrong quote, not a crash.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run verify      # re-runs the costing regression checks — do this after ANY change to catalog.js or costing.js
npm run build        # production build
```

`npm run verify` runs `scripts/verify.mjs` in plain Node — no browser, no
build step. It caught two real bugs during development (a duplicate
"Pump" resource key silently overwriting itself, and Trench Mesh/Square
Mesh/Stock Bar being costed off tonnage instead of their catalog $/unit
price). Treat a red `verify` run the same as a broken build.

## Architecture

```
src/
  data/catalog.js       — ALL domain data. No React, no logic. Plain arrays/objects.
  lib/costing.js         — ALL domain logic. Pure functions, no React, no DOM.
  lib/storage.js          — the ONE hook that talks to localStorage.
  components/              — presentation only. Should not contain business rules
                             (a component multiplying qty * rate itself, instead of
                             calling computeElementCost, is a bug waiting to diverge).
  App.jsx                    — composition root: wires storage + costing + components together.
scripts/verify.mjs            — Node-runnable regression checks for lib/costing.js.
```

**Why data/logic/UI are split like this:** `data/catalog.js` and
`lib/costing.js` have zero React or DOM dependency, so they can be
imported directly by plain Node (`scripts/verify.mjs` does exactly this).
That's what makes fast, no-browser regression testing possible. If you
move costing logic into a component (e.g. compute a row's cost inline in
`CategoryBlock.jsx` instead of via `computeElementCost`), you lose that
safety net silently. Keep all cost arithmetic in `lib/costing.js`.

## Costing rules (the part that's easy to get subtly wrong)

1. **Every product in `FULL_CATALOG` is shown on every element type, always.**
   There is no per-element filtering of which categories or products
   apply — that was a deliberate decision (an estimator wants to see the whole
   catalog and decide per job what applies, not have the tool guess).
   A blank quantity costs $0 and contributes nothing — that's what makes
   showing the whole catalog on every tab harmless. **Do not add
   per-element-type filtering of catalog rows** without checking that's
   actually what's wanted; it was explicitly requested to be removed once
   already (see git history / prior conversation) after an earlier
   version tried to curate a subset per element type.

2. **Only `PROCESSED BAR` costs off Total Weight, and only `SQUARE MESH`
   costs off Total Area.** Processed Bar's catalog `unitCost` is genuinely
   $/tonne (`weightBasis: true`). Square Mesh's `unitCost` is genuinely
   $/sheet, but the estimator enters **m² of coverage**, not a sheet count
   — `areaBasis: true` tells `computeRowTotal` to cost it as
   `ceil(qty / sheetArea) * unitCost` (sheets are bought whole, so this
   always rounds up; `sheetArea` — 14.4 m², a standard 6.0×2.4m sheet — is
   a per-product catalog/rate field, editable in the Rates modal like
   `unitWeight`). Every other category — including Trench Mesh and Stock
   Bar, which also carry a `unitWeight` — costs as `qty * unitCost`
   directly, because their catalog price is per length/bar, not per tonne;
   that leftover `unitWeight` exists purely so the UI can show informational
   tonnage (useful for delivery planning). **`computeRowTotal` in
   `costing.js` is the ONE place that implements all three rules — always
   call it (from `computeElementCost`, `CategoryBlock.jsx`,
   `PrintQuoteReport.jsx`) rather than recomputing a row total inline
   anywhere else, or the three will eventually disagree.** If you add a new
   weight- or area-priced category, set the matching flag in `catalog.js`.
   If you're unsure whether a category should be `true` on either flag, it
   almost certainly shouldn't be — only Processed Bar and Square Mesh are.

3. **Percentages are fractions, not whole numbers.** `overheadPct: 0.08`
   means 8%, not `8`. A whole-number entry displayed with a `%` format
   but stored as `8` would multiply through as 800%. This bit the
   original Excel workbook once. There's no UI validation preventing
   someone typing `8` instead of `0.08` in the Overheads/Contingency
   inputs right now — if you're touching `QuoteSummary.jsx`, consider
   whether the input should divide by 100 for a more human-friendly "type
   8 for 8%" UX, but if you do, update `computeMarginLadder`'s callers
   consistently (don't have some callers pass fractions and others
   percentages).

4. **The margin ladder divides, it doesn't multiply.** Sell price =
   `subtotal / (1 - margin)`, not `subtotal * (1 + margin)`. A 30% margin
   on cost is not the same number as a 30% markup — this app implements
   margin-on-sell-price (the construction-industry convention BOMA ESTIMATES
   uses), matching the original workbook. See
   `computeMarginLadder` in `costing.js`.

5. **`RESOURCE_COLS` has two entries named "Pump"** (`pump_hr` and
   `pump_m3` — the catalog prices pumping both per hour and per m³ of
   concrete pumped). They're distinguished by `key`, not `name`. Anywhere
   you index labour data by resource, **use `key`, never `name` alone** —
   keying by name was a real bug during development (the `pump_hr`
   column's totals silently went missing because a `{name: column}` map
   only kept the last "Pump" entry). If you add another resource that
   shares a name with an existing one, give it a distinct `key` and check
   `verify.mjs`'s "BOTH Pump columns" test still passes as a pattern to
   follow.

6. **Rate lookups always fall back to the catalog default.** Use
   `lookupRate(rates, key, fallback)` (or the same `rates[key] || fallback`
   pattern) everywhere a rate is read — never index into the `rates`
   object directly and assume the key exists. This matters because a
   user's saved `rates` blob in localStorage predates any future catalog
   additions; a missing key should degrade to the catalog default, not
   render blank/undefined pricing. `verify.mjs` has a test for this
   ("falls back to catalog default rather than $0") — keep it passing.

7. **Concrete delivery fees are auto-applied, per the Holcim schedule.**
   Three CONCRETE rows cost themselves from the element's poured volume
   rather than being typed: **Minimum cartage** (a delivered load under
   `MIN_CARTAGE_THRESHOLD_M3` = 4 m³ is charged $80 per m³ SHORT of 4 —
   *per truck*, so the volume is split into `TRUCK_LOAD_M3` (8 m³) loads
   and only the last, part load can be short), the **production &
   transport surcharge** and the **environment levy** (both flat $/m³ on
   every delivered m³). Typing a Qty on any of those rows takes that row
   fully manual — that's how a known delivery split is priced exactly.
   None of the three count towards `concreteQty` (they're fees, not
   poured volume), and none is charged on the others. See
   `autoMinimumCartage` / `autoConcreteSurcharge` / `autoEnvironmentLevy`
   in `costing.js` — each has exactly ONE implementation, called by
   `computeElementCost`, `CategoryBlock.jsx` and `PrintQuoteReport.jsx`.

8. **Contract minimums bill through `computeRowTotal`.** A product can
   carry a `minQty` (the 7th field in its catalog row) — a "4 hour min"
   pump bills 4 hours for a 1-hour job. `computeRowTotal` raises the
   quantity to `minQty` before any weight/area/length basis applies, and
   only when the row has a quantity at all (a blank row still costs
   nothing). Every CONCRETE PUMPING rate and minimum comes from the
   supplier's schedule and is editable in the Rates modal.

9. **GST is hardcoded at 10%** (`GST_RATE` in `catalog.js`). This is an
   Australian tool. If this is ever adapted for another market, that's
   the one place to change — but check every place `GST_RATE` or `* 1.1`
   is used (currently just `computeMarginLadder`).

## How to extend

- **Add a new material product:** add a row to the relevant category's
  `products` array in `catalog.js` — `[name, unit, unitWeight, unitCost]`,
  `unitWeight`/`unitCost` are `null` if not applicable. It will
  automatically appear on every element card and in the Rates modal; no
  other file needs to change.

- **Add a new material category:** add an object to `FULL_CATALOG`
  (`{ key, weightBasis, products }`) — it renders automatically via the
  `FULL_CATALOG.map(...)` in `ElementCard.jsx`. Decide `weightBasis`
  carefully — see rule 2 above.

- **Add a new element type (tab):** add an entry to `ELEMENT_TYPES` in
  `catalog.js` with a `category` (the broad, foldable group shown as
  optgroups in the Add-Element dropdown and as the outer fold in
  QuoteSummary — e.g. `FOUNDATIONS`, `SUSPENDED STRUCTURE`), a `section`
  (the finer sub-group nested under category in QuoteSummary — existing
  or new), and a `labour` key pointing at one of the `LABOUR_TEMPLATES`
  (or a new one, if the task sequence genuinely differs — e.g.
  ground-bearing slabs pour blinding and lay poly; suspended slabs prop
  and strip formwork instead; excavation-only elements don't pour
  concrete at all). Both `category` and `section` are required — `npm run
  verify` fails an entry missing either. Keep new entries in roughly
  ground-up construction order in the array (earthworks → foundations →
  retention → substructure → vertical structure → suspended structure →
  external/landscape → pool → civil) — that order is what the dropdown
  and summary display, and it's meaningful to an estimator scanning the
  list. `ELEMENT_TYPES` is deliberately comprehensive — every
  concrete/structural element BOMA ESTIMATES might meet across any building or
  civil project, not curated per job (see rule 1).

- **Add a new labour resource:** add to `RESOURCE_COLS` with a unique
  `key`. It appears as a new column in every element's Labour/Equipment
  matrix and in the Rates modal automatically.

- **Change default prices:** edit the `unitCost`/`unitWeight` values
  directly in `catalog.js`. Note this only changes what a *fresh install*
  seeds — a user who has already opened the Rates modal and edited a
  price has that override saved in `localStorage` under `boma-rates`,
  which takes precedence (see `lookupRate`). There's currently no "reset
  to catalog defaults" button; add one if that's needed (clear the
  relevant key from the stored rates object).

## Multi-project dashboard

The app has two views, switched in `App.jsx` by whether `activeId` points
at a project: the **Dashboard** (`components/Dashboard.jsx`) lists every
project with a live-computed summary row (direct cost, sell at the default
margin, $/m², element count) and a portfolio-wide totals footer; opening
one renders `ProjectEditor`, the original single-quote UI, scoped to that
project's own storage key. `lib/projects.js` holds a lightweight index —
`{ id, storageKey, createdAt }` per project — under `PROJECTS_INDEX_KEY`;
everything else (name, date, GFA, items) lives in the project's own quote
object, read via `readQuote`/`readQuotes`. An install that predates
multi-project support (a single quote under the old fixed `boma-quote`
key) auto-migrates into project #1 the first time the index loads empty —
see `migrateLegacyQuote`.

## Trial gate (portal shell)

The deployed portal is a **limited trial build**, and the whole gate lives in
`portal/portal-shell.html` — nowhere else. There is no backend, so it is one
hardcoded password plus a usage counter in localStorage:

- **Password `5120`** (`TRIAL_PASSWORD`), the same for everyone. There are no
  per-user accounts any more — the old email allow-list + per-user PIN, and
  its "Change PIN" modal, are gone.
- **A session lasts 1 hour** (`SESSION_MS`). A second-resolution ticker drives
  the countdown pills on the dashboard and in the app bar, and signs the user
  out the moment the hour is up.
- **5 sessions are allowed** (`TRIAL_MAX_SESSIONS`), which is also
  **5 hours of clock** (`TRIAL_MAX_MS`). Whichever runs out first locks the
  portal permanently on the `GET FULL VERSION` screen (`#screen-locked`).

State lives under `boma-trial` as
`{ sessionsUsed, msUsed, current: { startedAt, expiresAt } | null }`. Two
rules to keep in mind if you touch it:

1. **`msUsed` counts finished sessions only.** Time for the session in
   progress is derived from `current.startedAt` on every read
   (`trialMsUsed`), so closing the tab mid-session doesn't hand back free
   time — the hour keeps running whether the page is open or not. That's also
   why a plain reload never spends a session: `restore()` sees a live
   `current` and resumes it rather than starting a new one.
2. **A session is spent on sign-in, not on expiry.** Ending one early (the
   "End session" button) still burns the session but banks only the minutes
   actually used, so the last session is capped to whatever is left of the
   five hours — see the `Math.min(SESSION_MS, TRIAL_MAX_MS - t.msUsed)` in
   the submit handler.

This is a **demo limiter, not a security boundary**: it is per-browser,
clearing site data resets it, and the password is in the shipped source. If
this ever needs to actually hold, it has to move server-side.

Note the gate is in the portal shell only. `npm run dev` serves the bare
Quotes SPA (`index.html` → `src/main.jsx`) with no gate at all, which is
what you want while developing; `npm run build:portal` — what Vercel runs —
is the gated artifact.

## Renamed storage keys

Every localStorage key this app owns is prefixed `boma-`. That prefix used to
be `gradcon-`, so `src/lib/legacyKeys.js` (`migrateLegacyKeys`, called from
`src/main.jsx`) copies each `gradcon-*` key to its `boma-*` twin on startup —
only where the new key isn't already set, so it's idempotent and never
clobbers newer work. The three vanilla-JS portal tools and the shell carry a
compact inline copy of the same logic at the top of their first `<script>`,
so they migrate correctly when opened standalone too. If you add a key, use
the `boma-` prefix and nothing else needs to change.

## Optional Supabase backend

`lib/storage.js`'s `useStoredState` — the one hook every piece of
persisted state goes through — transparently backs onto Supabase (a
single `estimator_kv(key, value, updated_at)` table, see
`supabase/migrations/0001_estimator_kv.sql`) when
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set, and falls back to
per-browser `localStorage` otherwise. This is exactly the "network-backed
implementation swapped in without touching any component" the hook's
`[value, setValue, status]` signature was originally kept generic for.
Components never check which backend is active. Both the Supabase load
and save paths are wrapped in `try/catch` — a network failure (not just an
API-level error) must still resolve `status` to `"error"`, never leave it
hung on `"loading"` forever (App.jsx blocks rendering on the projects
index finishing its load).

`lib/supabaseClient.js` reads the client only from env vars — never
hardcode a URL or key. `VITE_SUPABASE_ANON_KEY` must be the
anon/publishable key; the secret/service_role key bypasses every RLS
policy and must never ship in client code. See `.env.example`.

## PDF / print export

The "Print / PDF" button in `ProjectEditor` calls `window.print()`; the
browser's own print-to-PDF handles the export, no library needed. What
prints is **not** the on-screen editable UI — `components/PrintQuoteReport.jsx`
is a standalone report, hidden on screen and shown only under
`@media print` (via Tailwind's `print:` variant), built straight from
`computeElementCost`. Two reasons it's separate rather than just revealing
the existing cards: (1) collapsed `ElementCard`/`CategoryBlock` sections
are conditionally unmounted, not just visually hidden, so CSS alone can't
print their contents regardless of on-screen collapse state; (2) printing
the full catalog (114 products per element) would be useless — the report
lists only lines with a quantity entered. The rest of the editor gets
`print:hidden` (see `App.jsx`). `@page` sizing lives in `index.css`.

## Self-service element types (Element Types modal)

`ELEMENT_TYPES` in `catalog.js` stays a static, code-reviewed list — but
An estimator can add their own element types from the app itself via the "Element
Types" button (`components/ManageElementTypesModal.jsx`), so a new job
that needs an element type nobody's coded yet doesn't have to wait on a
code change. Custom types are stored separately under
`boma-custom-element-types` (`{id, category, section, name, labour}`,
same shape as a built-in entry, `labour` restricted to the existing
`LABOUR_TEMPLATES` keys) and merged with the built-ins at render time in
`App.jsx` (`allElementTypes`/`allCategoryOrder`/`allSectionOrder`), which
is what actually gets threaded down to `AddElementBar`, `QuoteSummary` and
`PrintQuoteReport` as props — `data/catalog.js` itself is never written to.
If you add a new prop-consuming place that needs the element list, take
`elementTypes`/`categoryOrder` as props with the built-in exports as
defaults, the way those three components do, rather than importing
`ELEMENT_TYPES` directly.

## Estimates → Quotes import bridge

The separate "Estimates" tool (BOMA Element Takeoff Engine, embedded
in the combined portal) computes generic quantities — a bar diameter +
length, a concrete grade + volume — that don't line up 1:1 with Quotes'
named catalog SKUs. "Publish to Quote" in that tool writes its live
Quantity Register (`{project, lines}`, i.e. its own `allLines()` output)
to `localStorage["boma-estimate-export"]` and asks the portal shell to
switch to the Quotes app; `App.jsx` picks that up on load, runs it through
`lib/estimateImport.js`'s `buildImportFromEstimate`, and creates a new
project from the result. That function is deliberately conservative: it
only prefills a catalog quantity where the match is unambiguous (an exact
element-type match, a bar diameter that exists in Processed Bar, a
concrete grade with exactly one product, wall formwork against the one
"Walls" product) and pushes a plain-English flag onto `quote.importFlags`
for everything else (ambiguous concrete mixes, formwork it can't
identify, element types Quotes has no equivalent for, trench mesh — see
the file's comments for why that last one can't auto-map even though it
reuses Square Mesh's SL/RL codes). `ImportFlagsBanner.jsx` shows those
flags once, on the freshly-created project; dismissing just clears
`quote.importFlags`. Extend `ESTIMATE_TYPE_MAP` there (not `catalog.js`)
if Estimates gains an element type Quotes already has a match for.

## Known limitations, on purpose (not oversights)

- **No auth, even with Supabase configured.** The `estimator_kv` RLS
  policy allows the anon key to read/write every row — this matches the
  app's original "no login" design, just shared across devices instead of
  confined to one browser, not a security boundary. Anyone with the URL
  and the anon key can edit any project's rates and quotes. Fine for a
  single-team internal tool; tighten the policy (require `auth.uid()`) if
  this ever needs real per-user accounts.
- **No undo.** Every edit is immediate and only reversible by hand
  (or duplicating an element before making risky changes to it).

## Design conventions

- Tailwind utility classes throughout, no CSS-in-JS. Palette: `neutral-*`
  for structure, `blue-950`/`blue-9xx` for the "blueprint navy" header
  chrome, `orange-*` (safety/hi-vis) for money figures and primary
  actions, `amber-*` for the labour matrix (visually distinct from
  material sections). Numbers are `font-mono tabular-nums` throughout so
  columns of figures align — keep that convention for any new numeric
  display.
- Every material/labour input is a controlled `<input type="number">`
  via the shared `NumInput` component (`components/atoms.jsx`) — reuse
  it rather than writing a new number input, it already handles the
  "empty string vs. 0" distinction correctly (an empty cell means "not
  entered", not "zero").
- Category blocks and the whole element card are independently
  collapsible — this was a deliberate response to "the full catalog on
  every tab is a lot of rows"; don't remove the ability to collapse in
  the name of simplifying the DOM.

## Verifying a change before calling it done

1. `npm run verify` — must pass.
2. `npm run dev` and manually add one of each element-type "shape"
   (an excavation-type, a footing-type, a wall-type, a slab-type) and
   confirm quantities still roll up into the sticky total and the Quote
   Summary rail, folded under the right category and section.
3. If you touched `computeElementCost` or `computeMarginLadder`, add a
   new case to `scripts/verify.mjs` covering it before merging — that
   file is the project's only regression net and should grow with the
   logic, not stay static.
4. If you touched the Dashboard or multi-project flow: create a second
   project, add different elements to each, and confirm the Dashboard's
   per-row totals and "All projects" footer match what each project's own
   Quote Summary shows.
