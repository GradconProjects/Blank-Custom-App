# BOMA ESTIMATES Portal — Complete Build Specification

Build a single-deployable web portal for **BOMA ESTIMATES** (an Australian concrete subcontractor) containing four tools behind one login: **Rates Library**, **BOMA Cost Planner**, **Quotes**, and **Estimates** (an element takeoff engine), plus two views that live inside Quotes: **Planner** and **Project Vault** (documents). Everything ships as ONE static `index.html` deployable to Vercel or any static host.

---

## 1. Architecture & Repo Layout

```
/
├─ src/                      # Quotes app — React 18 + Vite + Tailwind
│  ├─ data/catalog.js        # ALL domain data. No React, no logic.
│  ├─ lib/costing.js         # ALL costing logic. Pure functions, no React/DOM.
│  ├─ lib/storage.js         # ONE hook for persistence (localStorage/Supabase)
│  ├─ lib/projects.js        # multi-project index
│  ├─ lib/planner.js         # deadline/priority helpers
│  ├─ lib/estimateImport.js  # Estimates→Quotes import mapping
│  ├─ lib/exportQuote.js     # Excel-HTML + CSV export builders
│  ├─ components/            # presentation only — NO business rules
│  └─ App.jsx                # composition root
├─ portal/
│  ├─ portal-shell.html      # login + dashboard + Settings + app host (vanilla)
│  ├─ estimates-app.html     # Element Takeoff Engine (single-file vanilla JS)
│  ├─ estimates-schema.js    # pure: schema version, migration, raw backup (inlined + Node-tested)
│  ├─ estimates-orders.js    # pure: procurement rounding, order/pour schedules, reconciliation (inlined + Node-tested)
│  ├─ estimates-3d/main.js   # Three.js viewer (built by vite.3d.config.js → dist/assets/estimates-3d.js)
│  ├─ rates-library.html     # Rates Library (single-file vanilla JS)
│  └─ cost-planner.html      # Cost Planner (single-file vanilla JS)
├─ scripts/
│  ├─ assemble-portal.mjs    # builds the combined dist/index.html (inlines the pure modules, asserts every step)
│  ├─ build-download.mjs     # download/ zip: cloud-connected + offline single-file copies (+ source)
│  ├─ verify.mjs             # Node-only costing regression suite (Quotes)
│  ├─ verify-estimates.mjs   # Node-only Estimates suite: migration, backup, orders, Quotes bridge
│  └─ …
├─ docs/ESTIMATES_COVERAGE.md # coverage audit: real-world item → calculator + modifier
├─ tests/fixtures/estimates/  # real legacy takeoffs the Estimates suite runs against
└─ supabase/migrations/0001_estimator_kv.sql
```

**Assembly model:** `npm run build:portal` = `vite build` (Quotes → JS bundle) then `assemble-portal.mjs`, which takes `portal-shell.html` and embeds each app as a **base64-encoded `<script type="text/plain" id="<app>-app-b64">` block** (Quotes = its built HTML+JS inlined; the three vanilla apps = their HTML files verbatim). At runtime the shell decodes the chosen app's base64, creates a `Blob`, and loads it into a full-page `<iframe src=blob:>`. Because the blob URL inherits the shell page's **origin**, all apps share `localStorage` — this is the backbone for cross-app preferences and data bridges. Total output ~2 MB.

**Data/logic/UI split rule (Quotes):** `catalog.js` and `costing.js` must have zero React/DOM imports so `scripts/verify.mjs` can import them in plain Node. Never compute a row total inline in a component.

---

## 2. Portal Shell (`portal-shell.html`)

### 2.1 Auth
- `ALLOWED_EMAILS = ['owner@example.com','projects@example.com']`, `DEFAULT_PIN='2580'`; per-email PIN overrides stored under localStorage `boma-portal-pins`. Login screen: email `<select>` + 4-digit PIN. A "Change PIN" modal (current/new/confirm). Session persists in localStorage `{currentUser, activeApp}`; `restoreSession()` re-enters the last open app on reload. NOT a security boundary — internal tool.

### 2.2 Dashboard
- Header: boma logo (base64 PNG), right side: "Signed in as …", **Settings** button (gear icon), Change PIN, Log out.
- Hero: eyebrow "DASHBOARD", h1 "What are you working on?", intro paragraph, wide construction-site photo (base64 JPEG, `dash-hero-art`, hideable via Settings).
- **Panel grid: 6 tiles on one row ≥1100px (3-col tablet, 1-col mobile), fully centre-aligned content.** Each tile: a 144px (192px tablet) rounded badge on its own pastel background containing a **colourful flat-cartoon inline SVG** (48×48 viewBox, ~76% fill): ①Rates Library=blue ledger+price tag+green $ coin, ②Cost Planner=bar chart+trend arrow+gold $ coin, ③Quotes=document+orange calculator+$ badge, ④Estimates=blueprint+yellow scale ruler+pencil, ⑤Planner=red calendar+clock, ⑥Project Vault=grey safe with lime dial+manila folder. Below: centred title, description, "OPEN X →" CTA. Tag `01`–`06` pinned top-right. Tiles ⑤/⑥ target Quotes with `data-initial-view="planner"/"folder"`.
- Tile click → `openApp(target)`: decode base64 → blob iframe; "← Portal" back button returns to dashboard (`about:blank`s the iframe).

### 2.3 Design tokens
`:root`: `--bg:#fafafa; --surface:#fff; --surface-2:#f5f5f5; --line:#e2e2e2; --text:#231f20; --muted:#6b6b6b; --accent:#d5de5d; --accent-hover:#c6d045; --accent-ink:#1c1c1c; --focus:#231f20; --radius:14px`. Buttons: `.btn-primary` (accent bg), `.btn-ghost` (outline). Modals: fixed backdrop `rgba(35,31,32,.4)`, centred card, `[hidden]` toggle.

### 2.4 Settings modal (the control centre)
Wide (620px), scrollable, sectioned. One shared localStorage blob **`boma-preferences`** readable by every app (same origin). Numeric fields left blank store nothing (app defaults apply); selects at their default delete the key; toggles store explicit booleans. "Reset all" clears the blob. Saving reloads an open app iframe.

| Section | Setting | Prefs key | Wiring |
|---|---|---|---|
| Appearance | Accent colour (6 swatches + `<input type=color>`) | `accentColor` | sets `--accent`/`--accent-hover` (auto-darkened) live + on boot |
| | Text size S/M/L | `portalFontScale` | root font-size 93%/100%/109% |
| | Show hero photo | `showHero` | toggles `.dash-hero-art` |
| | Open after sign-in (any of 6 tiles) | `portalDefaultApp` | after fresh login / restored session w/o active app, click the matching tile once per page-load; Back always shows dashboard |
| Quotes-pricing | Money decimals 0–3 | `moneyDecimals` | `money2()` |
| | GST rate % | `gstRatePct` | `getGstRate()` |
| | Default margin % | `defaultMarginPct` | `getDefaultMargin()/getMarginSteps()` |
| | Overheads/Contingency % (new projects) | `overheadPct`,`contingencyPct` | `blankQuote()` seeds ÷100 |
| Quotes-workflow | Dashboard sort | `quotesDefaultSort` | Dashboard `sortBy` initial |
| | New project status | `quotesDefaultStatus` | `blankQuote()`, validated vs `QUOTE_STATUSES` |
| | Planner default priority | `plannerDefaultPriority` | PlannerView fallback, validated |
| App behaviour | Ask before deleting (default ON) | `confirmDeletes` | off ⇒ single-click delete everywhere (Quotes dashboard arm, Estimates card arm, register confirm()) |
| | Reopen last project in Quotes (ON) | `quotesRememberProject` | off ⇒ always land on Dashboard |
| | Quotes cards start collapsed | `quotesCardsCollapsed` | ElementCard `cardOpen` initial |
| | New Estimates elements collapsed | `estNewCollapsed` | sets `inst._collapsed` on add |
| | Auto-publish Estimates→Cost Planner (ON) | `estAutoPublish` | gates `scheduleAutoPublish()` |
| | Estimates opens on tab | `estStartPage` | synthetic tab click on boot |
| Estimates defaults | waste %s (concrete/reo/formwork), lap %, bulking %, cover mm, bar stock mm, grade MPa | `estConcreteWaste,estReoWaste,estFormworkWaste,estLapPct,estBulking,estCover,estBarStock,estGrade` | overlay onto `PROJECT` defaults before saved state loads |
| | Length unit mm/m; measurement rule | `estLenUnit`,`estMeasurementRule` | same overlay |
| | Default trench-mesh type; default slab mesh; lap-on-by-default | `estTrenchMeshType`,`estMeshType`,`estLapDefaultOn` | per-new-element `applyElementPrefs()` (see 5.6) |

**Checkbox gotcha:** the generic `.field input{appearance:none}` (for text-input styling) strips native checkbox rendering — no tick ever draws. Settings checkboxes must restore `appearance:auto` and pin `accent-color: var(--focus)` (dark), never `var(--accent)` (a lime tick on white is invisible).

---

## 3. Quotes App — Data (`src/data/catalog.js`)

Plain arrays/objects only:
- **`FULL_CATALOG`**: material categories, each `{key, weightBasis?, areaBasis?, products:[[name,unit,unitWeight,unitCost],...]}`. Categories incl. CONCRETE, PROCESSED BAR (`weightBasis:true`, priced $/tonne), TRENCH MESH (15 products: `3–6 Bar-L8TM` 6.8/9.2/11.6/13.9 kg; `3–6 Bar-L11TM` 13.3/17.7/22.3/26.8; `3–7 Bar-L12TM` 16.3/21.8/27.3/32.8/38.75; `3–4 Bar-L16TM` 28.9/38.5 — weights per 6 m length), SQUARE MESH (`areaBasis:true`, `sheetArea:14.4` m² = 6.0×2.4 m sheet, priced $/sheet, qty entered in m²), STOCK BAR, FORMWORK, etc. ~114 products.
- **`RESOURCE_COLS`** labour/equipment columns — includes **two entries named "Pump"** (`pump_hr`, `pump_m3`). Always index by `key`, never name.
- **`LABOUR_TEMPLATES`** task lists per element family; **`PRODUCTION_RATES`** for labour prefill suggestions.
- **`ELEMENT_TYPES`**: comprehensive list `{id, name, category, section, labour}` in ground-up construction order (earthworks→foundations→retention→substructure→vertical→suspended→external→pool→civil). `CATEGORY_ORDER`, `SECTION_ORDER`.
- Constants: `GST_RATE=0.10`, `DEFAULT_MARGIN=0.30`, `MARGIN_STEPS=[0.10..0.40]`, `QUOTE_STATUSES=["Queued","Estimating","Quoting","Tendered","Successful","Unsuccessful","On Hold"]`, `PLANNER_PRIORITIES=["Urgent","High","Medium","Low"]`.

---

## 4. Quotes App — Logic & UI

### 4.1 Costing rules (`lib/costing.js`) — sacred, verify-covered
1. **Every product shows on every element type** — no per-element filtering. Blank qty = $0; harmless. Do not curate.
2. **`computeRowTotal` is the ONE place** implementing: PROCESSED BAR = qty(t)×$/t (weightBasis); SQUARE MESH = `ceil(qty_m² / sheetArea)`×$/sheet (areaBasis, whole sheets); everything else `qty×unitCost`. Trench Mesh/Stock Bar carry `unitWeight` purely for informational tonnage.
3. **Percentages are fractions** (`0.08` = 8%).
4. **Margin divides:** sell = `subtotal/(1−margin)` (margin-on-sell, construction convention), never `×(1+margin)`.
5. Rate lookups via `lookupRate(rates,key,fallback)` — a missing saved key degrades to catalog default, never $0.
6. `rateKey(cat,name,unit)` = `"CAT::Name::unit"` used for both rates and quantities.

Key exports: `money(n)` whole-AUD; `money2(n)` reads `moneyDecimals` pref via `readPrefs()` (try/catch JSON.parse of `boma-preferences`; Node-safe fallback); `getGstRate()`, `getDefaultMargin()` (bounded <95%), `getMarginSteps()` (merges custom default into MARGIN_STEPS so the highlight row always exists); `computeElementCost(item,rates)` (materials + labour matrix + custom items); `computeGrandTotal`; `computeMarginLadder(direct,ohPct,contPct,gfa,steps)` → `{subtotal, rows:[{margin,sellExGst,sellIncGst,perM2}]}` using `getGstRate()`; `computeExternalScopeLines` (per-element share of real sell); `suggestedLabourPrefill`; `uid()`.

### 4.2 Storage (`lib/storage.js`, `lib/projects.js`)
`useStoredState(key, initial)` → `[value,setValue,status]`. Backs onto **Supabase** when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` env vars exist (single table `estimator_kv(key text pk, value jsonb, updated_at timestamptz)`, RLS open to anon — deliberate no-auth internal tool), else localStorage. Both paths try/catch; network failure resolves status `"error"`, never hangs `"loading"`. Merge-safe writes for the projects index; echo-resave guard; slow-poll + focus/visibility re-fetch for near-live cross-device sync. `projects.js`: index `[{id,storageKey,createdAt}]` under `boma-projects-index`; each project's quote object under its own `storageKey`; `readQuote/readQuotes/writeQuote/deleteQuote`; legacy single `boma-quote` auto-migrates to project #1.

### 4.3 UI (components/)
- **App.jsx**: navy sticky header (Tailwind `blue-950`), buttons Element Types + Rates; tab bar Dashboard / Planner / **Project Vault**; view switch by `activeId`. `blankQuote()` seeds `{projectName:"",projectDate:today,gfa,overheadPct(pref÷100||.08),contingencyPct(pref||.05),status:prefStatus(),items:[]}`. Remembers active project in `boma-active-project` (skipped when `quotesRememberProject===false`). Reads portal-set `initial-view` flag (planner/folder tiles) and the Estimates publish payload on mount.
- **Dashboard.jsx**: project rows (name/date/deadline/status pill/elements/GFA/direct cost/Sell @default-margin/$per m²) + portfolio footer + 4 stat tiles; sort select (pref-seeded); two-click arm delete (skipped when confirmDeletes off — never native `confirm()`, it's blocked in sandboxed iframes).
- **ProjectEditor**: AddElementBar (optgrouped dropdown) → ElementCard per item: collapsible card (pref-initial), every FULL_CATALOG category as collapsible CategoryBlock (qty inputs via shared `NumInput` handling empty-vs-0), amber LabourMatrix keyed by resource `key`, AdditionalItems (custom qty×rate lines), per-element total. Sticky grand total. QuoteSummary rail: category→section rollups + margin ladder table (default row highlighted via `getDefaultMargin()`), overheads/contingency inputs (fractions!), GFA.
- **PlannerView**: per-project deadline/priority/requirements + communications log; "Attend to now" (Urgent/High or due ≤7d, via shared `lib/planner.js isUrgent`) vs "Can defer"; cards collapsed by default. **ProjectFolderView ("Project Vault")**: per-project + shared Office document folders (files in storage as base64/IndexedDB), comms, "Last upload" line.
- **Print/PDF**: `PrintQuoteReport` hidden on screen, shown under `@media print` only (rest of app `print:hidden`); lists only lines with qty; margin ladder; built from `computeElementCost` — never reveal on-screen cards (collapsed ones are unmounted). `ExternalQuoteReport`: client-facing quotation (letterhead, per-element sell lines via `computeExternalScopeLines`, terms). `exportQuote.js`: Excel-flavoured HTML workbook + CSV, same numbers.
- **ManageElementTypesModal**: user-added element types stored under `boma-custom-element-types`, merged with built-ins at render; components take `elementTypes/categoryOrder` as props defaulting to built-ins.
- **RatesModal**: edit every product's `unitCost/unitWeight/sheetArea` → overrides saved under `boma-rates`.
- **ImportFlagsBanner**: shows `quote.importFlags` from an Estimates import once; dismiss clears.

### 4.4 Regression suite (`scripts/verify.mjs`)
Plain-Node assertions (~27): weight/area basis rules, ceil sheets, both Pump columns, rates fallback ≠ $0, ladder divides + GST, GFA=0 safe, ELEMENT_TYPES all have category+section, import mapping cases. `npm run verify` must pass after ANY change to catalog/costing. Prefs getters must fall back to catalog constants when `localStorage` is undefined (Node).

---

## 5. Estimates App (`portal/estimates-app.html`) — Element Takeoff Engine

Single-file vanilla JS, dark theme, no build step. Syntax-check by extracting `<script>` blocks and `new Function(src)` in Node. 5 tabs: **1 Project Setup · 2 Elements · 3 Workspace · 4 Quantity Register · 5 Export**. Header: Save button + live "Saved hh:mm:ss" status.

### 5.1 State & helpers
```js
let PROJECT = { name,jobNumber,client, units_len_pref:"mm", cover:40, grade:32,
  reoStandard:"Australian D500N", barStock:12000, concreteWaste:5, reoWaste:3,
  formworkWaste:0, lapPct:5, bulking:15, revision:"Rev A", measurementRule:"gross",
  estimateSessionId };
let SELECTED_TYPES={}, INSTANCES=[], ID_COUNTER=1, UPLOADED_FILES=[];
```
Immediately after declaring PROJECT, overlay `boma-preferences` (est* keys, unit, rule), then snapshot `DEFAULT_PROJECT_TEMPLATE = deepclone(PROJECT)` for fresh takeoffs. Helper `portalPref(key)` = one-key read of the prefs blob.

Core functions:
- `withWaste(q,w)=q*(1+w/100)`; `withWasteLap(q,w,l)=q*(1+w/100)*(1+l/100)` — waste and lap are separate multiplicative factors, NEVER merged. **No automatic lap heuristic**: every reinforcement item has its own explicit "Include lap allowance (%)" checkbox (field name ending `Lap`, default false) feeding `lap = flag? PROJECT.lapPct : 0`.
- `massPerM(dia)=dia²/162` (D500N approx); `barDiaOf("N16")→16`; `anchorLen(type,dia,custom)` for straight/hook90/135/180/cog.
- `MESHTYPES={SL52:1.87,SL62:2.42,SL72:3.05,SL81:3.11,SL82:3.70,SL92:4.68,SL102:5.60,RL818:2.98,RL1018:3.85,RL1118:4.63}` kg/m²; `MESH_SHEET_AREA_M2=14.4`.
- `TRENCH_MESH_TYPES` — same 15 names/weights as Quotes' catalog (§3) so the tools never disagree; `trenchMeshMassPerM(type)=kgPer6m/6`.
- `lineWeightKg(group,material,unit,qty)`: only Reinforcement/Connections; for unit m/lm check TRENCH_MESH_TYPES by name FIRST, else parse leading bar dia `/(\d+)/`×massPerM; mesh (m²) lines contribute 0 (their kg is informational via `sheets`).
- `overrideKeyFor(group,material,spec)` = `"G::M::S"` with `.[]` sanitised — content-derived so it survives reorders.
- `baseLine(inst,def,over)`: canonical line constructor `{stage,category,element,elementId,materialGroup,material,spec,qty,unit,waste,lap,finalQty,formula,linkedElement,notes}` + applies **manual overrides**: if `inst.data.manualOverrides[key].enabled`, `calculatedQty=finalQty; finalQty=ov.qty; manualOverride=true`; then computes `weightKg`.

### 5.2 Card engine (Workspace)
`addInstance(typeId)` → `{id:"EL"+n, typeKey, label, data: applyElementPrefs(calc.defaults(...))}`, cover from `DEFAULT_COVERS` (AS 3600-style per type: pier 65, pilecap/stripfooting/padfooting/retwall 50, slab-on-ground 30, raft 50, suspended slab 25, column 40, wall 35 …), `_collapsed` from pref. Card = sidebar tabs (Geometry/Concrete/Reinforcement/Formwork/Excavation/Connections/Results) built from calc's `render()` returning `{geom,conc,reo,form,exc,conns}` HTML strings; geometry pane shows a to-scale **SVG drawing sheet** (`sheetFrame` with "SHEET EL01 · NAME / NTS" title block, dimensions, spec line).

**Field binding (the key architectural pattern):** inputs carry `data-field="path.to.value"`; one delegated `input` listener does `setPath(inst.data, field, coercedValue)` then recompute. Helpers: `inpNum/inpText/selOpts/barSizeSel/chk(field,checked,label,toggle,rerender)/F(label,inner)`. `data-toggle="X"` show/hides `[data-show-if="X"]` (+`X_off` inverse) — **it never re-evaluates template ternaries**; any checkbox whose ON/OFF state changes which fields EXIST must pass `rerender:true` (5th chk arg) to rebuild the card (`rerenderCardKeepTab`). Selects reveal `[data-show-if="field_<value>"]`. Row tables (`addRow/delRow` actions) for openings, beam bar sets, ligature zones, extra connections. Deletes are two-click arm-confirm (skipped when confirmDeletes pref off). Duplicate button. `refreshCardResults` renders Results: totals row, **Reinforcement Summary by bar size/mesh type** (lm/kg and m²/sheets), and a full line table with **Manual?/Override Qty** columns (checkbox+number bound to `manualOverrides.<key>.enabled/.qty`).

### 5.3 Element calculators (CALC registry) — each with defaults/render/compute/diagram
- **Bored Pier**: qty/dia/depth, underream frustum, socket, extra %; concrete π/4·D²·H; spoil + bulked disposal; cage (vBars×(cageLen+anchorages+topProj+optional lap 40d or custom)); **circular ligatures** in top/mid/bottom confinement zones with hook 90/135/180, count line no. + m/kg notes + live zone diagram; starter bars OUT to cap (counted once at source); optional casing formwork.
- **Pile Cap**: pad OR cap/strap-beam shape; L×W×D concrete, blinding (concrete/compacted/loose granular), vapour membrane, oversized excavation; top+bottom X/Y mats (count=floor((dim−2c)/sp)+1, len=dim−2c, each with Lap% checkbox); **Side Bars/Ligatures — must be COMPUTED, not just rendered** (classic silent bug): beam shape ⇒ closed stirrups count=floor((L−2c)/sp)+1 × perimeter 2((W−2c)+(D−2c)); pad ⇒ perimeter side-face bars rows over depth (with lap); linked-pier incoming starters (visibility only, not double counted); column starters out; 0–4 formed faces.
- **Strip Footing**: L/W/D + trench W/exc depth/blinding/membrane; bottom+top longitudinal (qty,dia,lap), cross bars @spacing (lap), OR **"Trench mesh instead"**: named type dropdown (TRENCH_MESH_TYPES) + **Layers** multiplier + lap checkbox, qty in **lm**; ligature option; 0–4 trench faces formed; wall/column starters.
- **Pad Footing**: qty pads, pedestal option, sloping faces; bottom mat bars X/Y (lap) OR mesh sheet (type+layers+**extra lap**); **Ligatures/Starter-cage Ties** (dia, spacing, tie W×D; count=floor((D+pedH)/sp)+1×N — the missed column-base item); cast-ins (anchor/hold-down bolts, ferrules, plates, template); column starters; formed faces.
- **Ground/Suspended Beam**: beamType independent/integral/downstand/upstand; longitudinal **bar-set table** (position/qty/dia/**layers**/start+end anchorage/per-row Lap%) OR trench-mesh alternative (type+layers+lap, lm); **ligature zones table** (zone/length/dia/spacing → count no. + perimeter m/kg); side faces formwork by type.
- **Slab** (Slab on Ground/**Raft**/Waffle/Industrial/Suspended/Roof/Driveway/Path/Hardstand/Ramp/Basement — one calc, category-parameterised): L×W or manual-area (rerender:true — swaps bar UI to per-section schedule: mark/dia/span/spacing/len with live count=span/sp+1); thickness, perimeter auto 2(L+W) or override; base layer + membrane (ground only); **mesh** (type/layers/**extra lap**) — layers MUST multiply the costed area, `+10% base sheet laps` then optional `×(1+lapPct)`, `sheets=ceil(area/14.4)`; bar mats botX/botY (+topX/topY suspended) each toggle/dia/method spacing-or-count/**Lap%**; openings table (deduct area, reveal formwork); **Edge Thickening** (perimeter strip w×extra-d concrete); **Internal Beam Strips/Ribs** (raft ribs: total run length×w×extra-d concrete + **Beam Strip Reinforcement**: bars OR trench mesh — the toggle needs `rerender:true` — with layers+lap); edge return/turn-down U-bars (dia/spacing/turndown/leg + **Lap%**); joints @spacing + dowels; incoming starters; step-down dowels. Edge + soffit formwork.
- **Column**: rect/circular; vertical bars ×(H+projection) + **Lap%**; ligatures top/mid/bottom zones + cross ties; faces formwork; starters in/out with lap|coupler|starter.
- **Concrete Wall**: (L×H−openings)×t; Face A & B each vertical+horizontal dia/spacing/**Lap%**; faces/ends/top formwork; starters in, dowels out, step-down dowels, waterstop.
- **Retaining Wall**: compound (footing+heel/toe+key+stem) or **linked** to an existing footing (stem only + starters into it — no double count); footing X/Y + stem vert/hor bars each with **Lap%**; backfill volume; waterstop; dowels out.
- **Shotcrete Wall**: sprayed; central mesh (type/layers/**extra lap**); Xypex option; strip drain (scope-flagged).
- **Stairs**: risers/treads/width/waist; triangular step vol + waist + landing (manual overrides for irregular); main flight bars + **Lap%**; distribution bars (lap) OR mesh (layers+**extra lap**); starters.
- **Kerb**: run length×section; continuous bars + **Lap%**.
- **Tank/Box/Pool/Lift Pit** (rect or circular): base mat X/Y (+laps) or circular radial mesh-equivalent m² (+10% base, **extra lap** via baseXLap); wall vertical (+lap incl. base embedment) & horizontal (+lap); circular uses circumference/spacing.
- **Generic element**: manual concrete/reo(m + lap)/formwork/excavation entries.
- Every calc supports **Additional Connections** rows (target element/role/qty/dia/embed/proj/hook) — costed once at source, shown as "incoming" on the target.

**Lap coverage requirement:** every bar-RUN line has a lap checkbox; count-based ligatures/ties do not; every mesh/sheet line has an "Extra lap allowance (%)" on top of its 10% base overlap. `applyElementPrefs(data)` (called in addInstance): if `estLapDefaultOn` flip every `/Lap$/` key that is `false`→`true`; apply `estTrenchMeshType` to `trenchMeshType/beamStripsTrenchType`; `estMeshType` to `meshType/botMeshType/distMeshType` (validated against the tables).

### 5.4 Quantity Register (tab 4)
Filters (category/material-group/search). Grouped per element: collapsible `<tbody>` with header chip (id, label, live m³/kg/m² rollup, ✕ Remove). Columns: Stage|Category|Element|ID|Material Group(pill)|Material|Spec|Qty|Unit|Waste%|Lap%|**Manual?**(checkbox)|**Override Qty**(input)|Final Qty(+"✎ manual" badge w/ system calc tooltip)|Kg|Formula|Linked. The Manual?/Override inputs write the SAME `inst.data.manualOverrides` store as the card (delegated `t.oninput` by `data-reg-inst/key/sub` → `setPath` → `computeAllAndRefresh`). Above: project-wide **Reinforcement Summary** (bars by size lm/kg, mesh by type m²/sheets — one line per size). Below: stat tiles (m³, kg, tonnes, m² formwork, m³ excavation, line count).

### 5.5 Export (tab 5)
- **Publish to Quote & Cost Planner**: debounced auto-publish (1.2 s after changes, armed after first interaction, gated by `estAutoPublish`) writes `{project, lines: allLines()}` to localStorage `boma-estimate-export`; Quotes reads on load via `estimateImport.js` → creates a project, prefilling ONLY unambiguous matches (exact element type via `ESTIMATE_TYPE_MAP`, bar dia in Processed Bar, single-product grade, wall formwork) and pushing plain-English `importFlags` for everything else (ambiguous mixes, unmapped types, trench mesh — same SL/RL codes as square mesh, cannot auto-map). Cost Planner consumes the same payload.
- **CSV worksheets** (register/concrete/reinforcement/formwork/excavation/connections + export-all): UTF-8 **BOM**, `asciiSafe()` (×→x, ²→^2, —→-, ⌀→dia …), formula-injection guard (prefix `'` on leading =+−@) except intentional `rawFormula()` cells; Final Quantity is a LIVE Excel formula `=ROUND(H{r}*(1+J{r}/100)*(1+K{r}/100),4)`; columns …Waste %|Lap %|Final Quantity|Manual Override("Yes (system calc X)"/"No")|Formula|Linked|Notes. `download()` falls back to a copy-modal when the sandbox blocks downloads.
- **PDF Takeoff Report** (`window.print()` of `#printReport`): header (project/job/client/rev/date), defaults strip, Project Totals, **Material Summary** (concrete by grade / bars by dia lm+kg / mesh by type m²+sheets), element-by-element line tables with formulas, disclaimer footer. `@media print` must hide **every** `.page` + chrome (`header.app,nav.tabs,.toolbar,.filterbar,footer.note,.page{display:none!important}`) — hiding only some pages leaks app panels into the PDF.
- Save/Load project `.json` (full state incl. UPLOADED_FILES).
- **CSV import** (Project Setup): Bluebeam Markup-Summary or generic CSV → drafts one element per row by keyword→type regex map; applies only Count automatically; keeps raw measurement on the label tagged "⚠ From CSV import — verify"; Excel/PDF files attach for reference only, listed with remove buttons.

### 5.5a Export preview, report metadata and reconciliation (Phase 5)
- **Every export opens a preview first** (`openExportPreview({title, files:[{name, headers, rows}], note})`): the exact rows/columns of each file (first 60 rows shown, all in the download), row × column count, and the report header from `reportMeta()` — project, job, client, revision, drawing/spec revisions, **Prepared by** (`PROJECT.preparedBy`, Project Setup), reviewer acknowledgement, date, standards profile, register fingerprint, build. Download (all files for Export All) or Copy as text from the dialog; `download()` keeps the copy-fallback panel for JSON/backup paths.
- Worksheet CSVs stay pure tables (live Final Quantity formula); the order schedule, pour schedule and warnings CSVs append `reportTrailerRows()` (project, revision, preparer, reviewed, generated date, standards, fingerprint, disclaimer) under the data.
- **Reconciliation block** (Export page + PDF): `reconcile()` totals element cards, the Quantity Register and the export payload independently (concrete m³, reo kg, formwork m², blinding, vapour, excavation, spoil, line count, fingerprint) and ✓/✗ each row; a fourth "Last published" column appears after the first Publish and flags ⟳ stale rows when Quotes / Cost Planner are behind the takeoff.
- PDF header carries preparer and fingerprint; the Material Summary shows m³ to order and whole stock lengths; a Pour schedule table and the Reconciliation block follow.

### 5.5b Order Schedule (tab 6) — `portal/estimates-orders.js`
- One line per `group::material::unit` (the key `PROJECT.orderExclude` ticks are stored under, saved with the takeoff on every tick) with **Net | Waste + lap adjusted | Unit | Order qty | Order unit | Procurement rule | kg | t | Stock lengths / sheets | Elements**. Rules (`procurementRuleFor`): concrete 0.2 m³ steps; bars whole stock lengths at `PROJECT.barStock` (ligatures/stirrups counted in no. join through `lengthM`); trench mesh whole 6 m lengths; sheet mesh whole 14.4 m² sheets (line-level ceilings summed); mesh strips whole 6 m sheet lengths; formwork to 0.1 m²; excavation/base to 0.5 m³; vapour barrier to the whole m²; counts to whole items. Order is never less than adjusted; adjusted always equals the register.
- **Reinforcement by product**: bars by diameter (m, kg, t, stock lengths), trench mesh and strips by product (lengths), sheet mesh by type (sheets).
- **Pour schedule**: concrete by grade → element `pour` tag → element (level/zone shown), net / adjusted / order per row, each pour rounded up separately; own CSV export.
- `npm run verify` proves the module in Node against synthetic lines and every real fixture (rounding, keys, grouping, pour sort, reconciliation catches a changed quantity or a missing line).

### 5.6 Saved Takeoffs (multi-project) + cloud sync
- Keys: legacy blob `boma-estimate-state` (project #1 keeps it for continuity), later takeoffs `boma-estimate-state::proj_<rand>`; registry `boma-estimate-projects-index` = `[{id,name,key,savedAt}]`; active id `boma-estimate-active`; `CURRENT_PROJECT_KEY` variable is what save/load/sync use.
- **Saved Takeoffs bar** at top of Project Setup: chip per takeoff (name+saved time, active highlighted "▶", ✕ delete honouring confirmDeletes) + "+ New takeoff". Save writes ONLY the open takeoff and refreshes its index name/date. New: save current → fresh state from `DEFAULT_PROJECT_TEMPLATE` (+ seed 5 common types) → new key → save. Switch: save current (skip if just deleted) → point key → reset → `loadEstimateState()` → rerender all → cloud pull. Delete: remove key(+`__syncedAt`)+index entry, push `null` to cloud key; if active, switch to first remaining or auto-new.
- **Cloud sync** (Supabase REST, anon key, 8 s timeouts): `kvFetch(key)`/`kvPush(key,value)` with `Prefer: resolution=merge-duplicates`. `syncFromCloud()` (on boot, focus, visibilitychange, 6 s interval): pull index first (union-merge by id, newer savedAt wins name), then current key — apply only if cloud `updated_at` > local `__syncedAt`; seed cloud if empty; **capture key at start and abort apply if the user switched takeoffs mid-flight**. Form renderers must use `el.oninput=` (not addEventListener) so re-renders can't stack handlers.

---

## 6. Rates Library & Cost Planner (vanilla single-file apps)
- **Rates Library**: master catalogue of established rates (concrete supply, reinforcement $/t and per-item, formwork $/m², labour & plant day rates, accessories, preliminaries), grouped/searchable/editable, persisted to localStorage + the same Supabase kv, consumed as the source-of-truth defaults by the other tools.
- **Cost Planner**: portfolio workbook — project list, per-project BOQ/cost-control tabs, schedule, dashboard totals; auto-ingests the `boma-estimate-export` payload (creates/refreshes a matching project from Estimates' live register — keyed by `estimateSessionId` so re-publishes update in place, not duplicate); prints its own PDF report (Quotes' print layout matches its margins/typography).

---

## 7. Shared localStorage keys (one origin)
`boma-portal-pins` · portal session · `boma-preferences` (§2.4) · `boma-projects-index` + per-project quote keys · `boma-rates` · `boma-custom-element-types` · `boma-active-project` (per-browser, never synced) · `boma-estimate-state[::id]` (+`__syncedAt`) · `boma-estimate-projects-index` · `boma-estimate-active` · `boma-estimate-export` (bridge payload).

## 8. Supabase (optional, no-auth by design)
```sql
create table estimator_kv (key text primary key, value jsonb, updated_at timestamptz);
alter table estimator_kv enable row level security;
create policy anon_all on estimator_kv for all using (true) with check (true);
```
Anon/publishable key only — never service_role in client code. Every load/save try/catch-wrapped.

## 9. Build, verify, deploy
`npm run dev` (Vite, :5173) · `npm run verify` (must pass; treat red = broken build — Quotes costing suite + Estimates suite: migration, backup, orders module, Quotes bridge) · `npm run build` (Vite app + the 3D viewer bundle) · `npm run build:portal` (build + assemble; the assembler needs a FRESH build and cannot run twice on the same dist/index.html) → deploy `dist/` to Vercel (git-push CI) · `npm run build:download` regenerates `download/` (cloud-connected and offline single-file copies + source zip) — the ONLY way those files are produced; never edit them by hand. Local Playwright testing: move `.env.local` aside, plain build + assemble, serve dist via Node http, login grady/2580, find app frame via `page.frames().find(f=>f.url().startsWith("blob:"))`; click sidebar tabs by text with `{force:true}`, never fixed coordinates.

## 10. Acceptance checklist
1) `npm run verify` green (Quotes costing + Estimates suites). 2) Login→dashboard: 6 centred colourful tiles one row; Settings ticks visibly draw; every setting round-trips and actually changes behaviour (spot-check GST 12%/margin 25% flow to the ladder to the cent; Estimates fresh takeoff picks up cover/lap/waste/mesh defaults; auto-open lands in the chosen app once). 3) Quotes: add one element of each family shape; totals roll into sticky bar + summary under correct category/section; Square Mesh rounds sheets UP; both Pump columns total; print shows only entered lines. 4) Estimates: raft slab with edge thickening + internal beam strips + trench-mesh beam reo computes; every reinforcement item shows a lap checkbox and every mesh an extra-lap checkbox; pad-footing ties & pile-cap side-bars/stirrups produce lines; register override checkbox edits qty live; CSV opens clean in Excel with live final-qty formulas; PDF has no app chrome and includes the Material Summary; two Saved Takeoffs switch cleanly with independent state; second device sees both via cloud. 5) Publish to Quote creates a flagged, conservatively-prefilled project; Cost Planner reflects the same register. 6) Every export previews first with revision / preparer / date; the Export page reconciliation shows ✓ on every row and ⟳ stale against the last published copy after an edit; the Order Schedule shows net, adjusted and order quantities with the rule on each row, reinforcement by product with stock lengths, and a pour schedule grouped by grade → pour → element; the offline download copy runs all of this with no cloud.
