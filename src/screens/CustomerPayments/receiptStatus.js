// Shared bits for the Payment Receipts screens: account.payment state →
// label/colour, and the date format used on cards.
import { format, parseISO } from 'date-fns';

export const STATUS = {
  draft: { label: 'Draft', color: '#6b7280' },
  in_process: { label: 'In Process', color: '#2563eb' },
  paid: { label: 'Paid', color: '#16a34a' },
  canceled: { label: 'Cancelled', color: '#dc2626' },
  rejected: { label: 'Rejected', color: '#dc2626' },
};

export const statusOf = (state) => STATUS[state] || { label: state || '—', color: '#6b7280' };

export const fmtDate = (d) => {
  if (!d) return '—';
  try { return format(parseISO(String(d).slice(0, 10)), 'dd MMM yyyy'); } catch (_) { return String(d); }
};
