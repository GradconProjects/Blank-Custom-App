/**
 * Standard boilerplate for the External Quote (see components/
 * ExternalQuoteReport.jsx) — transcribed verbatim from a real Gradcon
 * quotation letter (9 Stonecutters Road, Portsea) so the seeded text is
 * Gradcon's actual known-good standard wording, not anything invented here.
 * These are only the DEFAULTS a brand-new external quote is seeded with —
 * once seeded they live in quote.externalQuote and are freely editable per
 * project; editing them here never touches an existing project's own text.
 */

export const DEFAULT_INCLUSIONS = [
  "Includes the supply and placement all reinforcement.",
  "Includes the supply and placement of concrete.",
  "Includes the supply and erection of all formwork as required.",
  "Includes the provision of concrete pumps as required.",
  "Includes curing of the concrete slab.",
].join("\n");

export const DEFAULT_EXCLUSIONS = [
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
  "Corking or sealing to saw cuts or constructions joints.",
  "Trench grates, pit lids or frames.",
  "Set out works and datum set up.",
  "Saw cutting or demolition of any existing concrete slabs, footings or paving.",
  "Cavity filling to any block work or retaining walls.",
  "Any reo to block or brick retaining walls, including starter bars from blockwork to suspended areas.",
  "Access towers.",
  "Access to all work areas must be available at all times.",
  "Any crane or hoisting.",
  "Grouting of any kind (e.g. base plates, precast panels, underpinning).",
  "Any grano screeds or toppings unless specified in the quotation.",
  "Traffic Control or permits for concrete pump set up and deliveries.",
  "Filling of any pockets or voids formed in the slab, e.g. column rebates and PT pockets.",
  "Location of services to be marked out by the builder before excavation is started.",
  "Protection of any existing concrete floors, paving or kerbs.",
].join("\n");

export const DEFAULT_CONTRACTUAL_CONDITIONS = `1) Allowances:
   a. Concrete:
      All material allowances are derived from minimum sizes and dimensions given in the structural drawings. Slabs requiring deeper beams will require additional concrete at blinding rate.
   b. Formwork:
      Additional formwork required for an elevated slab will incur additional costs unless clearly noted on the quote (i.e. deepened edge beams etc). This price includes a maximum 400mm edge form set up.

2) Additional Costs:
   a. Fill:
      Additional sand required to fill sites will be charged $65.00 per m3 + GST.
   b. Blinding:
      The supply of any blinding concrete due to collapsing ground conditions or increased beam depth required to achieve founding depth will be charged at $425.00 per m3 + GST which covers excavation, labour and concrete. (It does not include a pump. If a pump is required, an invoice will be supplied).
   c. Variations:
      Variations can be quoted and agreed upon. Alternatively, all variations will be Cost + 20% margin + GST. A detailed cost report will be provided for review.
   d. Stand down time:
      Stand down time due to delays by builder or other trades will be charged out at $85.00/hr + GST per man and $120.00/hr + GST per machine for plant hire.

3) Safety:
   a. Safety Caps:
      Safety Caps will be provided by Gradcon for all bars posing as hazardous. Caps are to be stored onsite and will be collected once their use is complete. Please advise if and when there are not required.
   b. Handrails:
      Safety handrails associated with formwork will be supplied by Gradcon - Note these temporary handrails will be removed once Gradcon's works have been completed.
   c. Deep Excavation:
      Gradcon has no allowances for safety barriers or shoring associated with deep excavation.
   d. Other:
      Refer to OHS/Insurances section of quotation for other particulars.

4) Site conditions:
   a. Builder is to ensure Gradcon is provided with updated drawings immediately they are issued.
   b. Builder to ensure a suitable access is available for vehicles (crushed rock road base or similar)
   c. Builder is to ensure that the site has a toilet.
   d. Builder is to ensure that the site has power available.
   e. Builder is to ensure that the site has water available.
   f. Builder is to ensure that all previous services have been disconnected.
   g. Setout and surveying to be done by the builder including building perimeter (concrete profile) and the location of steps, set downs and rebates.
   h. A bin is to be provided for the excess material generated from the works. If bin is not provided a neat pile of rubbish will be left on site.
   i. Water Control – The builder is, to the best of their ability, to provide a site that assists with surface water control (i.e. cut off drains).

5) Building & Construction Industry Security of Payment Act 2002:
   a. At Gradcon's sole discretion, if there are any disputes or claims for unpaid Services, then the provisions of the Building and Construction Industry Security of Payment Act 2002 may apply.
   b. Nothing in this agreement is intended to have the effect of contracting out of any applicable provisions of the Building and Construction Industry Security of Payment Act 2002 of Victoria, except to the extent permitted by the Act where applicable.

6) Quote Conditions:
   a. This quotation is valid for 30 days from date provided on the quote and may be subject to prices rises after that period.
   b. The quotation is not to have retentions held against it. Unless Agreed to.
   c. Unless "for construction" documents are provided at time of tender, all quotes will subject to review upon final documentation being issued.

7) OHS/Insurances:
   a. Work Cover Insurance Policy. Certificate of Currency provided on request.
   b. Public liability of $20,000,000.00. Certificate of Currency provided on request.
   c. All employees have a current White Card.
   d. Safe Work Method Statements (SWMS) provided as required.
   e. All employees will wear Hi-Vis clothing and hard hats when required.
   f. Material Safety Data Sheets (MSDS) provided on request.`;

export const DEFAULT_SIGNATURE_NAME = "Grady Fink";
export const DEFAULT_SIGNATURE_TITLE = "Director";

/** Fresh externalQuote object for a project that's never had one — mirrors
 * newElementItem's role for quote items. Seeded once; after that it's
 * whatever the estimator has typed. */
export function newExternalQuote() {
  return {
    attentionName: "",
    attentionCompany: "",
    scopeDescription: "Renovations",
    drawingsArchitect: "",
    drawingsStructural: "",
    tenderNotes: "",
    inclusions: DEFAULT_INCLUSIONS,
    exclusions: DEFAULT_EXCLUSIONS,
    contractualConditions: DEFAULT_CONTRACTUAL_CONDITIONS,
    signatureImage: null,
    signatureName: DEFAULT_SIGNATURE_NAME,
    signatureTitle: DEFAULT_SIGNATURE_TITLE,
  };
}
