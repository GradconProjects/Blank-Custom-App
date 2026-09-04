/**
 * Two export formats for the live quote, both built from the same
 * computeElementCost/computeGrandTotal/computeMarginLadder calls as
 * QuoteSummary.jsx and PrintQuoteReport.jsx — never recomputed inline, for
 * the same reason CLAUDE.md gives for computeRowTotal: one implementation,
 * so these can't silently drift from what the screen and the PDF show.
 *
 * - buildQuoteExcelHtml: an HTML table saved with a .xls extension and the
 *   `application/vnd.ms-excel` MIME type — Excel opens this natively and
 *   renders the inline styling (bold headers, category/section colour
 *   bands, borders, currency alignment) as real formatting, with zero
 *   spreadsheet library added to the bundle. Covers every section
 *   QuoteSummary.jsx shows on screen (item breakdown incl. elements with no
 *   quantities entered yet, per-category subtotal, Grand Total, GFA &
 *   On-Costs, Margin Ladder with the default margin highlighted), not just
 *   the lines PrintQuoteReport.jsx prints.
 * - buildQuoteCsv: a plain-text CSV of the same content, used as the
 *   text/plain clipboard fallback in ExportExcelModal (a paste target that
 *   can't accept the HTML clipboard format still gets usable text).
 */
import { FULL_CATALOG, RESOURCE_COLS, CATEGORY_ORDER, SECTION_ORDER } from "../data/catalog.js";
import { computeElementCost, computeGrandTotal, computeMarginLadder, rateKey, lookupRate, computeRowTotal, getDefaultMargin, getMarginSteps } from "./costing.js";
import { GRADCON_LOGO_DATA_URI } from "./logo.js";

/** Rate ($/unit) backed out from the line's own total ÷ qty — always exactly
 * reproduces `Total = Qty × Rate` for the reader, regardless of whether the
 * underlying category is costed by weight/area/length (see computeRowTotal). */
const rateOf = (total, qty) => (qty ? total / qty : 0);

/** Every line (material/labour/custom) actually filled in for one element, plus its total. */
function buildElementLines(item, rates) {
  const materialLines = [];
  FULL_CATALOG.forEach((cat) => {
    cat.products.forEach((p) => {
      const qKey = rateKey(cat.key, p.name, p.unit);
      const qty = Number(item.qtys[qKey]) || 0;
      if (qty > 0) {
        const rate = lookupRate(rates, qKey, {
          unitCost: p.unitCost ?? 0, unitWeight: p.unitWeight, sheetArea: p.sheetArea, barLength: p.barLength,
        });
        const rowTotal = computeRowTotal(cat, rate, qty);
        materialLines.push({ label: `${p.name} (${cat.key})`, qty, unit: p.unit, total: rowTotal });
      }
    });
  });

  const cost = computeElementCost(item, rates);
  const labourLines = RESOURCE_COLS.filter((res) => cost.resourceTotals[res.key] > 0).map((res) => ({
    label: res.name, qty: cost.resourceTotals[res.key], unit: res.unit, total: cost.resourceCosts[res.key],
  }));

  const customLines = item.additional
    .filter((a) => (Number(a.qty) || 0) > 0 && a.name)
    .map((a) => ({ label: a.name, qty: Number(a.qty) || 0, unit: a.unit, total: (Number(a.qty) || 0) * (Number(a.rate) || 0) }));

  return { cost, lines: [...materialLines, ...labourLines, ...customLines] };
}

/** Groups items the same way QuoteSummary.jsx does: category > section, only groups that have items. */
function groupItems(items, rates, categoryOrder, sectionOrder) {
  return categoryOrder
    .map((category) => {
      const catItems = items.filter((it) => it.category === category);
      if (catItems.length === 0) return null;
      const sections = sectionOrder
        .map((section) => {
          const secItems = catItems.filter((it) => it.section === section);
          if (secItems.length === 0) return null;
          return { section, elements: secItems.map((item) => ({ item, ...buildElementLines(item, rates) })) };
        })
        .filter(Boolean);
      const catTotal = sections.flatMap((s) => s.elements).reduce((sum, e) => sum + e.cost.total, 0);
      return { category, sections, catTotal };
    })
    .filter(Boolean);
}

/* ---------------- Excel (HTML table, .xls) ---------------- */

const COLORS = {
  navy: "#172554", navyText: "#ffffff",
  catBand: "#172554", catText: "#ffffff",
  sectionBand: "#dbeafe", sectionText: "#1e3a8a",
  totalBand: "#171717", totalText: "#fb923c",
  subtotalBand: "#f5f5f5",
  money: "#c2410c",
  border: "#d4d4d4",
  muted: "#737373",
  defaultMargin: "#ecfdf5",
};

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function td(content, { colSpan, align = "left", bold, bg, color, italic, border = true, numeric } = {}) {
  const styles = [
    numeric ? `mso-number-format:&quot;#,##0.00&quot;` : "",
    `padding:4px 8px`,
    `font-family:Calibri,Arial,sans-serif`,
    `font-size:11pt`,
    `text-align:${align}`,
    border ? `border:1px solid ${COLORS.border}` : `border:none`,
    bold ? `font-weight:bold` : "",
    italic ? `font-style:italic` : "",
    bg ? `background:${bg}` : "",
    color ? `color:${color}` : "",
  ].filter(Boolean).join(";");
  return `<td${colSpan ? ` colspan="${colSpan}"` : ""} style="${styles}">${content}</td>`;
}
const tr = (cells) => `<tr>${cells}</tr>`;

const ITEM_COLS = 6; // #, Element / Line, Qty, Unit, Rate ($), Total ($)

/** Meta table: a small, borderless label:value block — same shape as Cost
 * Planner's own project header (Project/Date/GFA/on-costs), so the two
 * apps' exports read as one family of document. */
function buildMetaTable(quote) {
  const rows = [
    ["Project", esc(quote.projectName || "Untitled project")],
    ["Client", esc(quote.clientName || "—")],
    ["Date", esc(quote.projectDate || "")],
    ["GFA", quote.gfa ? `${esc(quote.gfa)} m²` : "—"],
    ["Overheads", `${Math.round((Number(quote.overheadPct) || 0) * 100)}%`],
    ["Contingency", `${Math.round((Number(quote.contingencyPct) || 0) * 100)}%`],
  ];
  return `<table class="meta"><colgroup><col class="m0"><col class="m1"></colgroup>
${rows.map(([label, value]) => tr(
    td(label, { border: false, color: COLORS.muted }) + td(value, { border: false })
  )).join("\n")}
</table>`;
}

export function buildQuoteExcelHtml(quote, items, rates, categoryOrder = CATEGORY_ORDER, sectionOrder = SECTION_ORDER) {
  const groups = groupItems(items, rates, categoryOrder, sectionOrder);
  const grandTotal = computeGrandTotal(items, rates);
  const { subtotal, rows: marginRows } = computeMarginLadder(
    grandTotal, quote.overheadPct, quote.contingencyPct, quote.gfa, getMarginSteps()
  );

  let itemNo = 0;
  const rowsHtml = [];

  rowsHtml.push(tr(
    td("#", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
    + td("Element / Line", { bold: true, bg: COLORS.navy, color: COLORS.navyText })
    + td("Qty", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
    + td("Unit", { bold: true, bg: COLORS.navy, color: COLORS.navyText })
    + td("Rate ($)", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
    + td("Total ($)", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
  ));

  groups.forEach(({ category, sections, catTotal }) => {
    rowsHtml.push(tr(td(esc(category), { colSpan: ITEM_COLS, bold: true, bg: COLORS.catBand, color: COLORS.catText })));

    sections.forEach(({ section, elements }) => {
      rowsHtml.push(tr(td(esc(section), { colSpan: ITEM_COLS, bold: true, bg: COLORS.sectionBand, color: COLORS.sectionText })));

      elements.forEach(({ item, cost, lines }) => {
        rowsHtml.push(tr(
          td("", {})
          + td(esc(item.label), { bold: true })
          + td("", {}) + td("", {}) + td("", {})
          + td(cost.total.toFixed(2), { bold: true, align: "right", color: COLORS.money, numeric: true })
        ));

        if (lines.length === 0) {
          rowsHtml.push(tr(
            td("", {}) + td("&nbsp;&nbsp;No quantities entered", { italic: true, color: COLORS.muted })
            + td("", {}) + td("", {}) + td("", {}) + td("", {})
          ));
        } else {
          lines.forEach((l) => {
            itemNo += 1;
            rowsHtml.push(tr(
              td(String(itemNo), { align: "right", color: COLORS.muted })
              + td(`&nbsp;&nbsp;${esc(l.label)}`, {})
              + td(String(l.qty), { align: "right", numeric: true })
              + td(esc(l.unit), {})
              + td(rateOf(l.total, l.qty).toFixed(2), { align: "right", numeric: true })
              + td(l.total.toFixed(2), { align: "right", numeric: true })
            ));
          });
        }
      });

      rowsHtml.push(tr(
        td("", {}) + td(`${esc(section)} subtotal`, { bold: true })
        + td("", {}) + td("", {}) + td("", {})
        + td(elements.reduce((s, e) => s + e.cost.total, 0).toFixed(2), {
          bold: true, align: "right", bg: COLORS.subtotalBand, numeric: true,
        })
      ));
    });

    rowsHtml.push(tr(
      td("", { bg: COLORS.subtotalBand }) + td(`${esc(category)} SUBTOTAL`, { bold: true, bg: COLORS.subtotalBand })
      + td("", { bg: COLORS.subtotalBand }) + td("", { bg: COLORS.subtotalBand }) + td("", { bg: COLORS.subtotalBand })
      + td(catTotal.toFixed(2), { bold: true, align: "right", bg: COLORS.subtotalBand, numeric: true })
    ));
  });

  if (groups.length === 0) {
    rowsHtml.push(tr(td("No elements added yet.", { colSpan: ITEM_COLS, italic: true, color: COLORS.muted })));
  }

  rowsHtml.push(tr(
    td("", { bg: COLORS.totalBand }) + td("GRAND TOTAL (EX GST)", { bold: true, bg: COLORS.totalBand, color: COLORS.totalText })
    + td("", { bg: COLORS.totalBand }) + td("", { bg: COLORS.totalBand }) + td("", { bg: COLORS.totalBand })
    + td(grandTotal.toFixed(2), { bold: true, align: "right", bg: COLORS.totalBand, color: COLORS.totalText, numeric: true })
  ));

  const itemTableHtml = `<table class="items"><colgroup><col class="c0"><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"></colgroup>
${rowsHtml.join("\n")}
</table>`;

  const summaryRows = [];
  summaryRows.push(tr(
    td("Subtotal (+ Overheads + Contingency)", { bold: true })
    + td(subtotal.toFixed(2), { bold: true, align: "right", numeric: true })
  ));
  const summaryTableHtml = `<table class="summary"><colgroup><col class="s0"><col class="s1"></colgroup>
${summaryRows.join("\n")}
</table>`;

  const marginRowsHtml = [];
  marginRowsHtml.push(tr(
    td("Margin", { bold: true, bg: COLORS.navy, color: COLORS.navyText })
    + td("Sell (ex GST)", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
    + td("Sell (inc GST)", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
    + td("$/m² GFA", { bold: true, bg: COLORS.navy, color: COLORS.navyText, align: "right" })
  ));
  marginRows.forEach((r) => {
    const isDefault = Math.abs(r.margin - getDefaultMargin()) < 1e-9;
    const bg = isDefault ? COLORS.defaultMargin : undefined;
    marginRowsHtml.push(tr(
      td(`${Math.round(r.margin * 100)}%`, { bold: isDefault, bg })
      + td(r.sellExGst.toFixed(2), { align: "right", bg, numeric: true })
      + td(r.sellIncGst.toFixed(2), { align: "right", bg, numeric: true })
      + td(r.perM2 > 0 ? r.perM2.toFixed(2) : "", { align: "right", bg, numeric: r.perM2 > 0 })
    ));
  });
  const marginTableHtml = `<table class="margin"><colgroup><col class="g0"><col class="g1"><col class="g2"><col class="g3"></colgroup>
${marginRowsHtml.join("\n")}
</table>`;

  const sheetName = (quote.projectName || "Quote").slice(0, 31).replace(/[\\/*?:[\]]/g, " ");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${esc(sheetName)}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
<style>
table { border-collapse: collapse; margin-bottom: 6px; }
table.meta col.m0 { width: 110px; } table.meta col.m1 { width: 260px; }
table.items col.c0 { width: 36px; } table.items col.c1 { width: 320px; } table.items col.c2 { width: 80px; }
table.items col.c3 { width: 60px; } table.items col.c4 { width: 90px; } table.items col.c5 { width: 110px; }
table.summary col.s0 { width: 320px; } table.summary col.s1 { width: 110px; }
table.margin col.g0 { width: 90px; } table.margin col.g1 { width: 110px; } table.margin col.g2 { width: 110px; } table.margin col.g3 { width: 100px; }
</style>
</head>
<body>
<table><colgroup><col style="width:1px"></colgroup><tr><td style="border:none;padding:4px 8px;"><img src="${GRADCON_LOGO_DATA_URI}" height="34" alt="Gradcon Concrete Constructions"></td></tr></table>
${buildMetaTable(quote)}
${itemTableHtml}
${summaryTableHtml}
${marginTableHtml}
</body>
</html>`;
}

export function quoteExcelFilename(quote) {
  const name = (quote.projectName || "quote").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "quote";
  return `${name}.xls`;
}

/* ---------------- Plain-text CSV (clipboard fallback) ---------------- */

const csvField = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (...cells) => cells.map(csvField).join(",");

export function buildQuoteCsv(quote, items, rates, categoryOrder = CATEGORY_ORDER, sectionOrder = SECTION_ORDER) {
  const groups = groupItems(items, rates, categoryOrder, sectionOrder);
  const lines = [];
  lines.push(csvRow("GRADCON CONCRETE CONSTRUCTIONS"));
  lines.push(csvRow("Project", quote.projectName || "Untitled project"));
  lines.push(csvRow("Client", quote.clientName || ""));
  lines.push(csvRow("Date", quote.projectDate || ""));
  lines.push(csvRow("GFA", quote.gfa ? `${quote.gfa} m²` : ""));
  lines.push(csvRow("Overheads", `${Math.round((Number(quote.overheadPct) || 0) * 100)}%`));
  lines.push(csvRow("Contingency", `${Math.round((Number(quote.contingencyPct) || 0) * 100)}%`));
  lines.push("");
  lines.push(csvRow("#", "Category", "Section", "Element / Line", "Qty", "Unit", "Rate ($)", "Total ($)"));

  let itemNo = 0;
  groups.forEach(({ category, sections, catTotal }) => {
    let categoryPrinted = false;
    sections.forEach(({ section, elements }) => {
      let sectionPrinted = false;
      elements.forEach(({ item, cost, lines: elLines }) => {
        lines.push(csvRow("", categoryPrinted ? "" : category, sectionPrinted ? "" : section, item.label, "", "", "", cost.total.toFixed(2)));
        categoryPrinted = true;
        sectionPrinted = true;
        if (elLines.length === 0) {
          lines.push(csvRow("", "", "", "  No quantities entered", "", "", "", ""));
        } else {
          elLines.forEach((l) => {
            itemNo += 1;
            lines.push(csvRow(itemNo, "", "", `  ${l.label}`, l.qty, l.unit, rateOf(l.total, l.qty).toFixed(2), l.total.toFixed(2)));
          });
        }
      });
      lines.push(csvRow("", "", "", `  ${section} subtotal`, "", "", "", elements.reduce((s, e) => s + e.cost.total, 0).toFixed(2)));
    });
    lines.push(csvRow("", `${category} SUBTOTAL`, "", "", "", "", "", catTotal.toFixed(2)));
  });

  const grandTotal = computeGrandTotal(items, rates);
  lines.push("");
  lines.push(csvRow("", "", "", "GRAND TOTAL (EX GST)", "", "", "", grandTotal.toFixed(2)));

  const { subtotal, rows } = computeMarginLadder(
    grandTotal, quote.overheadPct, quote.contingencyPct, quote.gfa, getMarginSteps()
  );
  lines.push(csvRow("", "", "", "Subtotal (+ Overheads + Contingency)", "", "", "", subtotal.toFixed(2)));

  lines.push("");
  lines.push(csvRow("MARGIN LADDER"));
  lines.push(csvRow("Margin", "Sell (ex GST)", "Sell (inc GST)", "$/m² GFA"));
  rows.forEach((r) => {
    lines.push(csvRow(`${Math.round(r.margin * 100)}%`, r.sellExGst.toFixed(2), r.sellIncGst.toFixed(2), r.perM2 > 0 ? r.perM2.toFixed(2) : ""));
  });

  return lines.join("\r\n");
}

export function quoteCsvFilename(quote) {
  const name = (quote.projectName || "quote").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "quote";
  return `${name}.csv`;
}
