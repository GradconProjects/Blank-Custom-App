/**
 * Standard boilerplate + seeding for the Tender Quote (see components/
 * TenderQuoteReport.jsx) — the full standard wording of a subcontractor
 * concrete tender quotation, laid out section for section the way a real
 * one reads. These are only DEFAULTS: once seeded they live in
 * quote.tenderQuote and every field is freely editable per project.
 *
 * Line items are seeded from the project's own elements — the price from
 * each element's share of the real sell price (computeExternalScopeLines),
 * the dot points from the element's published estimating quantities
 * (concrete m³, reinforcement t, formwork m², mesh m² — the figures that
 * came across from the Estimates tab). Reseeding never runs over a tender
 * the estimator has already edited unless they ask for it.
 */
import { uid, computeElementCost, labourQuantities, computeExternalScopeLines, getDefaultMargin } from "./costing.js";

export const TENDER_INCLUSIONS = [
  "All detailed excavation.",
  "Includes the supply and placement of a 50mm minimum compacted sand bed as required.",
  "Includes the supply and placement of a polythene waterproof membrane as required.",
  "Includes the supply and placement all reinforcement to the correct requirements as per the structural documentation.",
  "Includes the supply and installation of starter bars for block walls, in-situ walls and columns.",
  "Includes the supply and placement of concrete to the correct requirements.",
  "Includes the supply and erection of all formwork and safety rails as required to suspended areas and stairs.",
  "Includes the provision of concrete pumps as required.",
  "Includes curing of the concrete slab.",
  "Includes one Australian Standard concrete test per pour if required (excludes footings & civil works).",
].join("\n");

export const TENDER_SPECIFIC_EXCLUSIONS = [
  "This quotation does not include removal of spoil or loading of trucks. Builder is to ensure the removal of spoil is carried out at such time as not to impede progress. (Refer 'Additional Options' above.)",
  "Dewatering has not been allowed for in this quotation. Builder is to ensure any dewatering is carried out as soon as practically possible to allow continuation of works.",
  "Insulation to slab beam sides is not included.",
  "Supply and placement of cast in plates is excluded from this quotation. BOMA ESTIMATES will assist in the placement as required.",
].join("\n");

export const TENDER_GENERAL_EXCLUSIONS = [
  "Blinding concrete. (Blinding will be charged at the rate specified below).",
  "Concrete pumping to any blinding concrete.",
  "Polystyrene insulation to underside of slab.",
  "Lagging to pipes within the slab.",
  "Rock excavation.",
  "Tanking or waterproofing.",
  "Any backfill, compacted or loose.",
  "Preparation of sub grade including replacement of soft spots.",
  "Planking and strutting to excavations.",
  "Propping and strutting of any existing structures.",
  "Selected finishes including colour, hardeners and sealers.",
  "Termite treatment.",
  "Placement of any HD bolts or cast in items.",
  "Bulk excavation or site cut or scrape.",
  "Precast panels or dowels to precast panels.",
  "Corking or sealing to saw cuts or constructions joints.",
  "Trench grates, pit lids or frames.",
  "Set out works and datum set up.",
  "Saw cutting or demolition of any existing concrete slabs, footings or paving.",
  "Cavity filling to any block work or retaining walls.",
  "Any reo to block or brick retaining walls, including starter bars from blockwork to suspended areas.",
  "Access towers.",
  "Access to all work areas must be available at all times.",
  "Any crane or hoisting.",
  "Propping footings to support precast panels unless specified in the quotation.",
  "Grouting of any kind (e.g. base plates, precast panels, underpinning).",
  "Any grano screeds or toppings unless specified in the quotation.",
  "Traffic Control or permits for concrete pump set up and deliveries.",
  "Filling of any pockets or voids formed in the slab, e.g. column rebates and PT pockets.",
  "Location of any existing services to be marked out by the builder before excavation is started.",
  "Protection of any existing concrete floors, paving or kerbs.",
].join("\n");

export const TENDER_CONTRACTUAL_CONDITIONS = `1) Allowances:
   a. Concrete:
      All material allowances are derived from minimum sizes and dimensions given in the structural drawings. Slabs requiring deeper beams will require additional concrete at blinding rate.
   b. Formwork:
      Additional formwork required for an elevated slab will incur additional costs unless clearly noted on the quote (i.e. deepened edge beams etc). This price includes a maximum 400mm edge form set up.

2) Additional Costs:
   a. Fill:
      Additional sand required to fill sites will be charged $65.00 per m3 + GST.
   b. Blinding:
      The supply of any blinding concrete due to collapsing ground conditions or increased beam depth required to achieve founding depth will be charged at $365.00 per m3 + GST which covers excavation, labour and concrete. (It does not include a pump. If a pump is required, an invoice will be supplied).
   c. Variations:
      Variations can be quoted and agreed upon. Alternatively, all variations will be Cost + 20% margin + GST. A detailed cost report will be provided for review.
   d. Stand down time:
      Stand down time due to delays by builder or other trades will be charged out at $85.00/hr + GST per man and $120.00/hr + GST per machine for plant hire.

3) Safety:
   a. Safety Caps:
      Safety Caps will be provided by BOMA ESTIMATES for all bars posing as hazardous. Caps are to be stored onsite and will be collected once their use is complete. Please advise if and when there are not required.
   b. Handrails:
      Safety handrails associated with formwork will be supplied by BOMA ESTIMATES - Note these temporary handrails will be removed once BOMA ESTIMATES' works have been completed.
   c. Deep Excavation:
      BOMA ESTIMATES has no allowances for safety barriers or shoring associated with deep excavation.
   d. Other:
      Refer to OHS/Insurances section of quotation for other particulars.

4) Site conditions:
   a. Builder is to ensure BOMA ESTIMATES is provided with updated drawings immediately they are issued.
   b. Builder to ensure a suitable access is available for vehicles (crushed rock road base or similar).
   c. Builder to ensure that the site has a toilet.
   d. Builder to ensure that the site has power available.
   e. Builder to ensure that the site has water available.
   f. Builder to ensure that all previous services have been disconnected.
   g. Setout and surveying to be done by the builder including building perimeter (concrete profile) and the location of steps, set downs and rebates.
   h. A bin is to be provided for the excess material generated from the works. If bin is not provided a neat pile of rubbish will be left on site.
   i. Water Control - The builder is, to the best of their ability, to provide a site that assists with surface water control (i.e. cut off drains).

5) Building & Construction Industry Security of Payment Act 2002:
   a. At BOMA ESTIMATES' sole discretion, if there are any disputes or claims for unpaid Services, the provisions of the Building and Construction Industry Security of Payment Act 2002 may apply.
   b. Nothing in this agreement is intended to have the effect of contracting out of any applicable provisions of the Building and Construction Industry Security of Payment Act 2002 of Victoria, except to the extent permitted by the Act where applicable.

6) Quote Conditions:
   a. This quotation is valid for 30 days from date provided on the quote and may be subject to prices rises after that period. Please note that due to the current volatility of pricing & supply of steel reinforcement and concrete, this quotation has a strict validity period of 30 days from time of quotation to commencement of works. Should works not commence within 30 days of this quotation, we reserve the right to review, and if necessary, pass on any increases incurred beyond the validity period.
   b. The quotation is not to have retentions held against it. Unless Agreed to.
   c. Unless "for construction" documents are provided at time of tender, all quotes will subject to review upon final documentation being issued.

7) OHS/Insurances:
   a. Work Cover Insurance Policy. Certificate of Currency provided on request.
   b. Public liability of $20,000,000.00. Certificate of Currency provided on request.
   c. All employees have a current White Card.
   d. Safe Work Method Statements (SWMS) provided as required.
   e. All employees will wear Hi-Vis clothing and hard hats when required.
   f. Material Safety Data Sheets (MSDS) provided on request.`;

export const TENDER_DEFAULT_OPTIONS = [
  { text: "Spoil removal (Provisional Sum based on 100m3). Additional spoil removal will be charged at $40.00/m3 + GST", price: "$7,600.00 + GST" },
  { text: "Bin hire rubbish/rubbish management", price: "$600.00 per skip + GST" },
  { text: "Blinding Contingency", price: "$365.00/m3 + GST" },
];

/** Tender line items are BUILDING LEVELS, not elements: elements are grouped
 * by the level named at the start of their label ("Basement - …",
 * "Ground Floor Raft", "First floor columns …"), each level priced as the
 * SUM of its elements' shares of the real sell price, with one summary dot
 * point per element (up to 4 — extras roll into the fourth) drawn from its
 * published estimating quantities. Elements without a level prefix group by
 * their broad category instead. Every field is editable afterwards. */
const LEVEL_PREFIX = /^(lower ground floor|lower ground|basement|ground floor|ground|first floor|second floor|third floor|fourth floor|fifth floor|first|second|third|fourth|fifth|level\s*\d+|l\d+\b|mezzanine|podium|rooftop|roof)/i;
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export function seedTenderItems(quote, items, rates) {
  const { lines } = computeExternalScopeLines(items, rates, quote.overheadPct, quote.contingencyPct, getDefaultMargin());
  const sellById = {};
  lines.forEach((l) => { sellById[l.id] = l.sellExGst; });
  const fmt = (n, dp = 2) => Number(n).toLocaleString("en-AU", { maximumFractionDigits: dp });

  // one short summary point per element — name + its most telling figure
  const summarize = (item) => {
    const cost = computeElementCost(item, rates);
    const lq = labourQuantities(item, rates);
    const m = (item.label || "").match(LEVEL_PREFIX);
    let name = item.label || "Element";
    if (m) name = name.slice(m[0].length).replace(/^[\s\-–:]+/, "") || name;
    const figs = [];
    if (lq.finishM2 > 0) figs.push(`approx. ${fmt(lq.finishM2)} m²`);
    if (cost.concreteQty > 0) figs.push(`approx. ${fmt(cost.concreteQty)} m³ concrete`);
    if (!figs.length && lq.formworkM2 > 0) figs.push(`approx. ${fmt(lq.formworkM2)} m² formwork`);
    if (!figs.length && lq.reinfTonnes > 0.005) figs.push(`approx. ${fmt(lq.reinfTonnes)} t reinforcement`);
    return { text: figs.length ? `${name} — ${figs.slice(0, 2).join(" / ")}` : name, concreteM3: cost.concreteQty || 0, sell: sellById[item.id] || 0 };
  };

  // group elements by building level (label prefix), else broad category
  const groups = []; // [{key, title, members:[summaries]}] in first-seen order
  const byKey = {};
  items.forEach((item) => {
    const m = (item.label || "").match(LEVEL_PREFIX);
    const key = m ? m[0].trim().toLowerCase() : `cat:${item.category || "general"}`;
    const title = m ? titleCase(m[0].trim()) : titleCase(String(item.category || "General works").toLowerCase());
    if (!byKey[key]) { byKey[key] = { key, title, members: [] }; groups.push(byKey[key]); }
    byKey[key].members.push(summarize(item));
  });

  return groups.map((g) => {
    const sell = g.members.reduce((s, mm) => s + mm.sell, 0);
    let points = g.members.map((mm) => mm.text);
    if (points.length > 4) {
      const extra = g.members.slice(3);
      const extraM3 = extra.reduce((s, mm) => s + mm.concreteM3, 0);
      points = points.slice(0, 3).concat(`plus ${extra.length} further items${extraM3 > 0 ? ` — approx. ${fmt(extraM3)} m³ concrete combined` : ""}`);
    }
    while (points.length < 4) points.push("");
    return {
      id: uid(),
      elementId: null,
      title: g.title,
      price: sell > 0 ? `$${sell.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + GST` : "",
      points: points.slice(0, 4),
    };
  });
}

/** Pull the first number out of a tender price string like
 * "$46,050.47 + GST" or "46050.47". Anything without a digit is $0. */
export const parseTenderPrice = (s) => {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
};

/** The Project Sum block's numbers, all ex-GST until GST is added last —
 * the line-item prices are "+ GST" figures, so the sum of them is ex-GST
 * too. A typed projectSumOverride replaces the items sum entirely (the
 * estimator's negotiated round figure); markup is an EXTRA document-level
 * markup entered as a whole % (10 = 10%) on top of prices that already
 * carry BOMA ESTIMATES' margin from the sell allocation, so it defaults OFF.
 * gstOn defaults ON (tenders normally print the GST and incl-GST lines);
 * legacy tenderQuote objects saved before these fields existed get the
 * same defaults via the `!== false` / falsy checks here. */
export function computeTenderProjectSum(tq, gstRate = 0.1) {
  const itemsSum = (tq.items || []).reduce((s, l) => s + parseTenderPrice(l.price), 0);
  const hasOverride = String(tq.projectSumOverride ?? "").trim() !== "";
  const base = hasOverride ? parseTenderPrice(tq.projectSumOverride) : itemsSum;
  const pct = Number(tq.markupPct);
  const markupOn = !!tq.markupOn && Number.isFinite(pct) && pct !== 0;
  const markupAmt = markupOn ? base * (pct / 100) : 0;
  const exGst = base + markupAmt;
  const gstOn = tq.gstOn !== false;
  const gst = gstOn ? exGst * gstRate : 0;
  return { itemsSum, hasOverride, base, markupOn, markupPct: markupOn ? pct : 0, markupAmt, exGst, gstOn, gst, incGst: exGst + gst };
}

export function newTenderQuote() {
  return {
    rev: "Rev.1",
    date: "",              // blank = the project date
    attentionName: "",
    attentionCompany: "",
    projectTitle: "",      // e.g. "New residence"
    projectAddress: "",    // one line per address line
    items: null,           // null = seed from the quote on first open
    showProjectSum: true,  // print the Project Sum block under the line items
    projectSumOverride: "", // blank = sum of the line items; typed $ replaces it
    markupOn: false,       // extra document-level markup (prices already carry margin)
    markupPct: "",         // whole %, e.g. 10 for 10%
    markupLabel: "Markup",
    gstOn: true,           // print GST and TOTAL incl. GST lines
    additionalOptions: TENDER_DEFAULT_OPTIONS.map((o) => ({ id: uid(), ...o })),
    drawingsArchitect: "",
    drawingsStructural: "",
    drawingsCivil: "",
    tenderNotes: "",
    inclusions: TENDER_INCLUSIONS,
    specificExclusions: TENDER_SPECIFIC_EXCLUSIONS,
    generalExclusions: TENDER_GENERAL_EXCLUSIONS,
    contractualConditions: TENDER_CONTRACTUAL_CONDITIONS,
    signatureName: "",
    signatureTitle: "Director",
  };
}
