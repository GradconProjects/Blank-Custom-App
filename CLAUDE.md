# BOMA ESTIMATES — instructions for Claude Code

This is BOMA ESTIMATES' estimating tool: pick a structural
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
   apply — that was a deliberate decision (Grady wants to see the whole
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
   margin-on-sell-price (the construction-industry convention BOMA
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
   rather than being typed: **Minimum cartage** (the poured volume is
   divided by `MIN_CARTAGE_THRESHOLD_M3` = 4 m³ into whole loads, and the
   REMAINDER of that division — a part load — is charged $80 per m³ it is
   short of 4; a volume that divides evenly leaves no remainder and costs
   nothing, so 11 m³ → 2 loads + 3 m³ → 1 m³ short → $80, while 12 m³ →
   nothing), the **production & transport surcharge** and the
   **environment levy** (both flat $/m³ on every delivered m³).
   `TRUCK_LOAD_M3` and the "Concrete truck load size" production rate no
   longer feed minimum cartage — the divisor is the 4 m³ minimum itself. Typing a Qty on any of those rows takes that row
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

9. **Reinforcement can be priced off a RATE instead of a schedule.**
   `REINFORCEMENT BY RATE` is the only `volumeRateBasis: true` category: its
   Qty is entered as **kg of steel per m³ of concrete** and it costs as
   `(qty * concreteM3 / 1000) * unitCost` (`unitCost` is $/tonne, as for
   Processed Bar in rule 2). This is the one basis whose cost depends on
   *another* category's quantities — the element's own CONCRETE rows — so
   `computeRowTotal` takes a 4th `ctx` argument that every caller builds with
   **`rowContext(item)`**. If you add a `computeRowTotal` call, pass that ctx;
   omitting it silently prices every rate row at $0 (it degrades to zero
   rather than `NaN`, so nothing crashes — it just quietly costs nothing).
   The delivery-fee rows are not poured volume (`pouredVolume` excludes
   them), so the levy and surcharge never inflate the steel.
   `computeElementReinforcementTonnes` counts these rows too, so a
   rate-priced element still drives steel-fixing crew days like a bar-listed
   one. These rows are an **alternative** to bar-listing, not an addition —
   an element carrying both a schedule and a rate buys its steel twice. That
   isn't enforced (a blank row costs nothing, exactly like every other row);
   the category label says so on its face instead.

10. **GST is hardcoded at 10%** (`GST_RATE` in `catalog.js`). This is an
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
  concrete/structural element BOMA might meet across any building or
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

## How a project is persisted (read before touching storage.js, projects.js or quoteVersions.js)

Three layers, each with a rule that was learned the hard way:

- **The live row** (`useStoredState` in `lib/storage.js`, one `estimator_kv`
  row per key) is the moving copy: every edit lands there within 500 ms. A
  failed save **retries on its own** (5 s → 15 s → 30 s → every 60 s) and the
  editor shows a red banner until it lands — a project once vanished
  because a save failed silently and the badge was the only sign. The hook
  cannot save an edit made before its row has loaded, so `ProjectEditor`
  renders nothing editable while `quoteStatus === "loading"`; never remove
  that gate. `applyRemote()` is the ONE way a stored value enters state —
  it arms the "remote apply" flag only when React will actually re-render
  (a same-reference `initial` bails out, and an armed flag would swallow the
  user's first real edit). `localEditPending()` is the ONE definition of
  "this browser is mid-write" that the poll, the realtime push and the
  cache-first reconcile all consult.
- **Cache-first mirrors** (`lib/localMirror.js`, `cacheFirst: true` on the
  projects index and the rates only) paint the last-known copy instantly
  with status `"syncing"`, then reconcile on `updated_at`. One-off
  migrations in `App.jsx` wait for `"saved"` (see `settled()`). **A project's
  quote is never cache-first**: its mirror would have to drop the markup
  drawings to fit, and a save from that copy would delete them. The
  dashboard's summary mirrors (drawings' image data stripped) exist only to
  draw rows. Every quote row is prefetched in one like-query at boot; the
  FIRST `readQuotes()` consumes it, later calls hit the database.
- **Versions** (`lib/quoteVersions.js`) are immutable full copies in the
  `boma-files` bucket under `quote-versions/<projectId>/` — one on every
  Save, one every N minutes (portal Settings `quotesAutosaveMinutes`, 0 =
  off) while the quote has changed, and one "before-restore" ahead of any
  restore. Nothing deletes a version. The same document shape is what "Save
  to computer" downloads and "Open .json" reads; filenames must stay ASCII
  (Chromium drops a download name containing an em dash or curly quote).

A new project is a **draft** held only in `App` state until it has a name
or an element (`onPromote`); leaving it unpromoted discards it, so an
"Untitled project" never persists. The dashboard prunes index entries whose
row does not exist (older than an hour, and only when the fetch plainly
succeeded) — an entry with no row is the other way "Untitled project" used
to appear.

The Quotes bundle is inlined into the portal and runs from a blob: URL, so
a relative chunk import cannot resolve there: `scripts/assemble-portal.mjs`
rewrites each lazily-loaded chunk (today only the PDF renderer) to
`location.origin + "/assets/<chunk>"` and asserts every step — a build only
succeeds with a working lazy path. `vite.config.js` turns the preload
helper off so the import takes the plain form that rewrite targets.

## Estimates layout switch (Phase 1 of the UX redesign)

Estimates has two layouts over ONE DOM and one set of calculators:
**classic** (the default: every element card stacked in the Workspace) and
**blueprint** (opt-in: element navigator | the selected card | inspector,
tutorials in a Help drawer, cooler tokens). The switch is the portal
preference `estBlueprintShell` (Settings → "Estimates: new blueprint layout",
or the ⇄ button in the Estimates header, which writes the same key through
`setPortalPref`). `applyShellMode(mode)` sets `body[data-shell]`, relabels
the tabs from `SHELL_LABELS`, and re-renders the workspace; every blueprint
style is scoped under `body[data-shell="blueprint"]`, so the classic skin is
untouched while the switch is off. `renderWorkspace()` branches to
`renderBlueprintWorkspace()` which mounts ONLY the selected element's card
(`BP_SELECTED_ID`) and never writes to `inst._collapsed` — the fold state
belongs to the classic layout. No layout state is ever saved into the
takeoff (`estimateStateSnapshot` is unchanged); a takeoff edited in one
layout opens identically in the other. `refreshCardResults` is the one hook
that refreshes the inspector and the navigator row after an edit — keep
calling it rather than recomputing totals in the shell code.

## Estimates cloud sync (read before touching saveEstimateState, syncFromCloud or kvPush)

Three rules, each learned from a real loss (18 Beach Road, 8 Sep 2026: a
second tab pushed its stale two-element copy over a five-element takeoff,
and the first tab pulled it back within six seconds):

1. **A tab never pushes a takeoff until it has reconciled with the cloud copy
   of that key this session** (`CLOUD_RECONCILED_KEY`, set by `syncFromCloud`).
   `pushTakeoffToCloud` is the ONE cloud writer for takeoff rows; edits made
   before reconciling are saved locally and go up afterwards
   (`PENDING_CLOUD_PUSH`). Pushes are serialised per key (`PUSH_STATE`) and an
   unchanged snapshot is never re-sent (`LAST_CLOUD_HASH`), so tabs cannot
   ping-pong echoes.
2. **Every push is conditional** on the row being unchanged since this tab
   last synced it (`kvPatchIfUnchanged`, PostgREST `updated_at=eq.`). On a
   conflict the other device's copy is kept as a cloud version
   (`other-device`) BEFORE this tab's live work goes up, and the estimator is
   told in the save-status line. This tab's in-memory work always wins — it is
   the human's latest intent — but nothing is discarded.
3. **Cloud versions are immutable and unlimited**: `keepEstimateVersion`
   writes `estimate-versions/<projectId>/<iso>-<source>.json` to the
   `boma-files` bucket on every 💾 Save, every N minutes while the takeoff
   changes (portal `quotesAutosaveMinutes`, 0 = off), before a cloud pull
   replaces local content that differs (`before-sync`), before any restore,
   and on every conflict. `📁 Projects ▾` lists them with restore. Nothing
   deletes a version. `scratchpad`'s `test-sync-safety.mjs` proves all three
   with two browsers on a mock cloud; keep it passing.

## Estimates provenance and status (Phase 2)

Data, not layout, so both layouts share it: `inst.entered[field] = true` is
recorded the moment a field is typed (`markEntered`); a field equal to
`defaultDataFor(typeKey)` and never typed reads as **Default**, never as
entered. `inst.review = {hash, at}` is written by "Mark reviewed"; the status
(Draft / Reviewed / Changed since review / Imported — verify) is DERIVED from
the hash on every read, so no edit path has to maintain it. `computeInstance`
normalises every warning to `{text, section}` and appends the generic checks
in `validateInstance` (cover vs section, spacing ≤ 0, openings ≥ host);
warnings never block a save. Manual overrides carry an optional `reason` next
to the quantity and `baseLine` copies it onto the line as `overrideReason`.
The blueprint-only chrome (header row 2, section rail, input chips, ↺ default,
inspector warnings/trace) all reads these; `refreshCardResults` → 
`refreshSectionRail` is the one refresh path.

## Estimates assembly checklist and 3D (Phase 2B, pad footing first)

The 3D model is a VIEW of the takeoff, never a second calculator.
`buildElementScene(inst)` (estimates-app.html) reads the same instance
fields and result lines the Quantity Register uses and returns a SceneModel
(`{units:"mm", nodes:[{id, role, geometry, included, ghost, visible,
fields}], dimensions, labels}`); the viewer in `portal/estimates-3d/main.js`
(Three.js 0.186.0, pinned, built by `vite.3d.config.js` into
`dist/assets/estimates-3d.js`) only draws it and never writes back. The
hosted portal fetches that file on demand from `location.origin + "/assets/…"`
the first time a 3D view opens; the standalone/offline copies embed it as
base64 through the `<!-- __BOMA_3D_BUNDLE__ -->` placeholder (asserted by
the assembler). Run the full `npm run build` before `assemble-portal.mjs` —
the assembler rewrites dist/index.html in place and cannot run twice on it.

Two independent controls, by rule: **Include in estimate** is the card's own
canonical checkbox/field (the checklist's checkbox carries the same
`data-field`, so the calculator recomputes and only then is the scene
rebuilt); **Visible in 3D** (`VIS_3D`, session-only, never saved) hides the
object and can never change a quantity. `padComponents(inst)` is the one
component tree (Core / Suggested—review / Included / Excluded / N/A); a
suggestion becomes Excluded or N/A only through an explicit decision stored
in `inst.scope[id] = {decision, reason}`, and `markReviewed` is refused while
any suggestion is undecided — "not applicable" is never the same as "not
reviewed". `refreshCardResults` → `refresh3D` is the only scene refresh
path; `renderWorkspace`/`rerenderCardKeepTab` dispose the viewer first, so a
viewer never outlives its card. No WebGL → the SVG drawing and checklist
stay fully usable. `scratchpad/test-3d.mjs` proves parity, visibility,
decisions, disposal and the fallback; keep it passing. Extending 3D to other
element families waits on the owner's approval of the pad footing.

## Estimates data-entry power tools (Phase 3)

- **Numeric fields are `<input type="text" inputmode="decimal" data-num>`**,
  not `type=number`: `parseNumInput(raw, displayUnit)` is the ONE parser —
  a hand-written tokenizer/recursive-descent evaluator for `+ - * / ( )`,
  thousands separators and a trailing `mm|cm|m` suffix (converted into the
  field's display unit from `fieldDisplayUnit`). It never calls `eval` or
  `Function`; anything it cannot parse is shown red and NOT stored. The
  display normalises to the result on change. Arrow keys step (Shift ×10),
  Enter in a table row adds a row, Ctrl+D duplicates the row, pasting a
  column fills down. Manual-override cells stay `type=number`.
- **Undo/redo** is snapshot-based: `computeAllAndRefresh` calls
  `undoCommit(UNDO_CTX)`; keystrokes in the same field within 1.5 s coalesce
  into one step; `applyLoadedEstimateState` resets the history on any real
  load/sync/restore so undo never crosses another device's save. Undo runs
  through the normal save path, so the autosaved copy and the cloud follow.
- **Templates** (`boma-estimate-templates`, local + cloud row) copy
  configuration only (`templateDataFrom`: no overrides, import flags,
  derived `_` fields); adding one gives a new ID and no results/history.
  "Copy values from…" and "Duplicate — settings only" (`DIM_FIELDS` reset)
  live in the card's ⧉ Duplicate ▾ menu.
- **Tags** `inst.tags = {level, zone, pour}` are data (saved); the navigator's
  multi-select (`BP_MULTI`, session) drives `bulkApply` for tags, review,
  delete. Bulk review skips elements with undecided assembly items.
- **Register**: `registerFilteredLines()` is the one filter (selects, chips,
  search incl. warnings and tags); `regGroupKey` groups by element /
  material / category / level / zone / pour; totals show filtered vs whole
  project; rows jump to their source section (`openLineSource` →
  `lineSection`); saved views (`boma-estimate-register-views`) and hidden
  columns (`boma-estimate-register-cols`) are per-browser preferences;
  "Export filtered view" exports exactly the rows shown.

## Estimates standards profile, allowances and review gate (Phase 4)

- `docs/ESTIMATES_COVERAGE.md` is the coverage audit (brief §11.3): map a
  new real-world item to an existing calculator + modifier first; the
  generic calculator (`kind` excavation / alteration / temporary / precast /
  civil) is the universal measured item. The Civil / Bridge library group
  renders only when `PROJECT.standards.projectType` is civil, bridge or water.
- `PROJECT.standards` (jurisdiction, NCC class/edition, project type,
  drawing/spec revisions, engineer, governing standards by exact designation
  from `STANDARD_OPTIONS`, measurement rules, rate base, currency/GST,
  `checks` thresholds) is recorded with the takeoff and printed on the PDF
  and warnings export. Standards are designations only — no standards text,
  no invented clause references.
- **Site & Placement Allowances** (`siteAllowancesSection` /
  `siteAllowanceLines`) put overbreak, rock, dewatering, backfill, placement
  method, propping and testing on every element as register lines whose spec
  reads "Scoped allowance — estimating item, not design". Blank = nothing.
- `validateInstance` emits three levels: `completeness` (○, counted),
  `sanity` (⚠, counted, thresholds from `standards.checks`) and `verify`
  (ⓘ, never counted as a warning — cover/grade from defaults, reinforcement
  adequacy, formwork design, pile capacity are confirmed from the engineer's
  documents). Wording never asserts a design verdict.
- The deliberate **Publish** is held by `publishBlockers()`: acknowledgement
  (`PROJECT.reviewAck` = name, role, time, `linesHash()`), stale
  acknowledgement, manual overrides without a reason, undecided assembly
  items. The live auto-publish that follows a first publish is unchanged.
  `DISCLAIMER_SHORT` appears in Project Setup, the Publish page, the PDF and
  the warnings CSV.

## Estimates data safety (schema, migration, recovery, raw backup)

`portal/estimates-schema.js` is pure and DOM-free: the assembler inlines it
into `estimates-app.html` (asserted) and `scripts/verify-estimates.mjs`
runs the same file in Node against real takeoffs in `tests/fixtures/estimates/`.
Rules: a snapshot without `schemaVersion` is v1; `migrateEstimateSnapshot`
deep-copies, repairs STRUCTURE only (never a value, a name or a unit — mm
stay mm, blank stays blank, zero stays zero), is idempotent, keeps unknown
fields, and THROWS for anything it cannot read. Every load path (boot,
cloud sync, save-history restore, Load .json) goes through it. A throw on
the open takeoff puts the app in RECOVERY MODE: read-only banner, raw copy
downloadable, and `saveEstimateState`/`autosaveLocal` refuse to write that
key — before this an unreadable row silently became a fresh takeoff that
the next autosave wrote over the original. On first load of each schema
version, before anything is parsed, every raw `boma-*` key is copied to
`boma-pre-migration-backup::<timestamp>` (never overwritten by the app;
excluded from later backups); Project Setup offers "Download full backup"
(all raw keys, with checksum) and the pre-migration copy. JSON downloads
carry no BOM. `npm run verify` runs both suites.

## Estimates orders, export preview and reconciliation (Phase 5)

`portal/estimates-orders.js` is the second pure, DOM-free module (same
contract as `estimates-schema.js`: inlined by the assembler, asserted, and
run in Node by `scripts/verify-estimates.mjs`). It never measures anything
— it groups, rounds and totals the register lines the calculators already
produce. Three quantities are kept apart on every order line and never
merged: **net** (`line.qty`), **adjusted** (`line.finalQty`, waste + lap —
the register/export figure) and **order** (adjusted rounded UP by the
material's procurement rule, with the rule text on the row:
`procurementRuleFor`). `ordersCtx()` in the app hands the module the facts
it must not hard-code (bar stock length from Project Setup, sheet area,
trench/strip stock 6 m, concrete step 0.2 m³, the mesh/trench product
tables). `orderScheduleFrom` keeps the `group::material::unit` key that
`PROJECT.orderExclude` ticks are stored under; `reinforcementByProduct`
groups bars by diameter (ligatures join their bar size through `lengthM`),
trench mesh and strips by product, sheet mesh by type; `pourSchedule`
groups concrete by grade → the element's `pour` tag → element and rounds
each pour separately (a separate delivery). `reconcile(sources)` totals
several line sets independently and compares them to the metric's decimal
places plus an order-independent `linesFingerprint`; the Export page shows
element cards = register = export payload, plus the copy last published
from this browser (stale = publish again). The PDF prints the same block.

**Every export previews first** (`openExportPreview`): the exact rows and
columns, row count, and the report metadata from `reportMeta()` (project,
job, revision, drawing/spec revs, `PROJECT.preparedBy`, reviewer, date,
standards, fingerprint, build). `download()` still shows the copy fallback;
the preview uses `triggerDownload()` and reports in-dialog. Worksheet CSVs
stay pure tables (their Final Quantity is a live row-relative formula); the
order schedule, pour schedule and warnings CSVs append `reportTrailerRows()`.
`scratchpad/test-phase5.mjs` proves the schedule, preview, reconciliation,
both bridges (Quotes and Cost Planner pick up one publish) and the offline
local-only mode; keep it passing with `npm run verify`.

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
Grady can add his own element types from the app itself via the "Element
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
