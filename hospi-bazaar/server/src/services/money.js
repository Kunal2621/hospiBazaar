'use strict';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** items: [{ quantity, unit_price, gst_rate }] -> per-line amounts and totals. */
function priceLines(items) {
  const lines = items.map((it) => {
    const line_subtotal = round2(it.quantity * it.unit_price);
    const line_gst = round2((line_subtotal * it.gst_rate) / 100);
    return { ...it, line_subtotal, line_gst };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.line_subtotal, 0));
  const gst_total = round2(lines.reduce((s, l) => s + l.line_gst, 0));
  return { lines, subtotal, gst_total };
}

const sameState = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Same state: CGST + SGST (half each). Different state: IGST. */
function gstSplit(supplierState, deliveryState, gstTotal) {
  if (sameState(supplierState, deliveryState)) {
    const cgst = round2(gstTotal / 2);
    return { gst_type: 'intra_state', cgst_total: cgst, sgst_total: round2(gstTotal - cgst), igst_total: 0 };
  }
  return { gst_type: 'inter_state', cgst_total: 0, sgst_total: 0, igst_total: round2(gstTotal) };
}

const toPaise = (rupees) => Math.round(round2(rupees) * 100);

module.exports = { round2, priceLines, gstSplit, toPaise };
