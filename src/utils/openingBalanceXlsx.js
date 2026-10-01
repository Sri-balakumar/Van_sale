// src/utils/openingBalanceXlsx.js
//
// Builds the "Aged Partner Balance" Excel that the Odoo opening-balance
// wizard (opening.balance.excel.import.wizard) reads. Column headers are the
// ones the wizard documents: Partner, 0-30, 30-60, 60-90, 90-120, +120.
// The workbook is produced straight as base64 — no file system, Buffer or
// btoa needed (Hermes on RN 0.73 has no btoa).
import * as XLSX from 'xlsx';

// `label` is what the app shows; `header` is what the wizard expects.
export const BUCKETS = [
  { key: 'b0_30', label: '0–30', header: '0-30' },
  { key: 'b31_60', label: '31–60', header: '30-60' },
  { key: 'b61_90', label: '61–90', header: '60-90' },
  { key: 'b91_120', label: '91–120', header: '90-120' },
  { key: 'b120p', label: '>120', header: '+120' },
];

// The paper-to-Excel sheets the client uploads today end with a Total
// column. The wizard only reads the bucket columns; the preview check in the
// publish flow fails safely if that ever changes.
const INCLUDE_TOTAL_COLUMN = true;

export const rowTotal = (row) => BUCKETS.reduce((s, b) => s + (Number(row?.[b.key]) || 0), 0);

export const nonZeroBuckets = (row) => BUCKETS.filter((b) => (Number(row?.[b.key]) || 0) > 0);

export const normalizeName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// The text written in the Partner column for each row. Two different
// customers with the same name get an id suffix so their preview lines can
// still be told apart (the publish flow sets the exact partner on each).
export const partnerCellNames = (rows) => {
  const counts = new Map();
  rows.forEach((r) => {
    const k = normalizeName(r.partnerName);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const out = new Map();
  rows.forEach((r) => {
    const name = String(r.partnerName || '').trim();
    out.set(r.partnerId, counts.get(normalizeName(name)) > 1 ? `${name} [#${r.partnerId}]` : name);
  });
  return out;
};

export const buildOpeningBalanceXlsx = (rows, ref) => {
  const names = partnerCellNames(rows);
  const header = ['Partner', ...BUCKETS.map((b) => b.header), ...(INCLUDE_TOTAL_COLUMN ? ['Total'] : [])];
  const body = rows.map((r) => [
    names.get(r.partnerId),
    ...BUCKETS.map((b) => Number(r[b.key]) || 0),
    ...(INCLUDE_TOTAL_COLUMN ? [rowTotal(r)] : []),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet['!cols'] = [{ wch: 36 }, ...header.slice(1).map(() => ({ wch: 12 }))];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Opening Balance');
  return {
    base64: XLSX.write(book, { type: 'base64', bookType: 'xlsx', compression: true }),
    fileName: `opening_balance_${ref}.xlsx`,
  };
};
