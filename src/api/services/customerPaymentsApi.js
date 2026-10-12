// src/api/services/customerPaymentsApi.js
//
// Payment Receipts — money received from customers (`account.payment`,
// payment_type inbound / partner_type customer), the app's version of the
// server's Accounting → Customers → Payments.
//
// Everything runs on the salesman's own session (/web/dataset/call_kw with the
// login cookie; authInterceptor adds the active company to the context), so
// each receipt is recorded under the salesman who took it.

import axios from 'axios';
import { getOdooUrl } from '@api/config/odooConfig';
import { getActiveCompanyId } from '@api/services/generalApi';

const TIMEOUT = 20000;

const PAYMENT_FIELDS = [
  'name', 'state', 'date', 'amount', 'currency_id', 'partner_id', 'journal_id',
  'payment_method_line_id', 'memo',
];

export class PaymentReceiptError extends Error {}

// The app never names the backend to users (a bare fault arrives as
// "Odoo Server Error").
const scrub = (msg) => String(msg || '')
  .replace(/odoo\s+server\s+error/gi, 'Server error')
  .replace(/\bodoo\b/gi, 'server')
  .replace(/^\s*\w/, (c) => c.toUpperCase());

const friendlyError = (err) => {
  const name = String(err?.data?.name || '');
  const raw = String(err?.data?.message || err?.message || '');
  console.warn('[PAYMENT_RECEIPTS] server error:', name, raw);
  if (name.endsWith('AccessError')) {
    return new PaymentReceiptError("This account doesn't have permission to record customer payments.");
  }
  if (name.endsWith('MissingError')) {
    return new PaymentReceiptError('This receipt was changed or deleted on the server. Refresh and try again.');
  }
  if ((name.endsWith('UserError') || name.endsWith('ValidationError')) && raw) {
    return new PaymentReceiptError(scrub(raw));
  }
  return new PaymentReceiptError('Something went wrong on the server. Please try again.');
};

const callKw = async (model, method, args, kwargs = {}) => {
  let resp;
  try {
    resp = await axios.post(`${getOdooUrl()}/web/dataset/call_kw`, {
      jsonrpc: '2.0',
      method: 'call',
      params: { model, method, args, kwargs },
      id: Date.now(),
    }, { headers: { 'Content-Type': 'application/json' }, withCredentials: true, timeout: TIMEOUT });
  } catch (e) {
    const timedOut = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
    throw new PaymentReceiptError(timedOut
      ? 'The server is taking too long to answer. Check the Draft and Done tabs before trying again.'
      : "Can't reach the server. Check the internet connection and try again.");
  }
  if (resp?.data?.error) throw friendlyError(resp.data.error);
  return resp?.data?.result;
};

export const m2oId = (v) => (Array.isArray(v) ? v[0] : (v || null));
export const m2oName = (v) => (Array.isArray(v) ? v[1] : '');

// Same lines as fetchPartnerOutstandingOdoo / Partner Ledger: what customers
// owe right now in the active company.
const receivableDomain = () => [
  ['company_id', '=', getActiveCompanyId()],
  ['account_id.account_type', '=', 'asset_receivable'],
  ['parent_state', '=', 'posted'],
  ['reconciled', '=', false],
];

const receiptDomain = ({ status, searchText, partnerId } = {}) => {
  const domain = [
    ['payment_type', '=', 'inbound'],
    ['partner_type', '=', 'customer'],
    ['company_id', '=', getActiveCompanyId()],
  ];
  if (status === 'draft') domain.push(['state', '=', 'draft']);
  if (status === 'done') domain.push(['state', '!=', 'draft']);
  if (partnerId) domain.push(['partner_id', '=', Number(partnerId)]);
  const t = String(searchText || '').trim();
  if (t) domain.push('|', ['name', 'ilike', t], ['partner_id.name', 'ilike', t]);
  return domain;
};

// Rounded to the currency's 3 decimals so float leftovers (99.99999…) don't
// show a customer as owing, or block paying their exact due.
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// Customers who owe more than 0, highest due first, each with their phone,
// last confirmed receipt and the total of any unconfirmed drafts.
// → { rows: [{ id, name, phone, due, lastPaid: {amount, date}|null, draftTotal }], total }
export const fetchCreditCustomers = async ({ searchText = '' } = {}) => {
  const domain = receivableDomain();
  const t = String(searchText || '').trim();
  if (t) domain.push('|', ['partner_id.name', 'ilike', t], ['partner_id.phone', 'ilike', t]);

  const groups = await callKw('account.move.line', 'read_group',
    [domain, ['amount_residual:sum'], ['partner_id']], { lazy: false });
  const owing = (groups || [])
    .filter((g) => Array.isArray(g.partner_id) && round3(g.amount_residual) > 0)
    .map((g) => ({ id: g.partner_id[0], name: g.partner_id[1], due: round3(g.amount_residual) }))
    .sort((a, b) => b.due - a.due);
  if (!owing.length) return { rows: [], total: 0 };

  const ids = owing.map((r) => r.id);
  const [partners, payments] = await Promise.all([
    callKw('res.partner', 'read', [ids, ['phone']]),
    callKw('account.payment', 'search_read', [[
      ...receiptDomain(),
      ['partner_id', 'in', ids],
      ['state', '!=', 'canceled'],
      ['state', '!=', 'rejected'],
    ]], { fields: ['partner_id', 'state', 'amount', 'date'], order: 'date desc, id desc' }),
  ]);
  const phoneOf = {};
  (partners || []).forEach((p) => { phoneOf[p.id] = p.phone || ''; });
  const lastPaid = {};
  const drafts = {};
  (payments || []).forEach((p) => {
    const pid = m2oId(p.partner_id);
    if (p.state === 'draft') drafts[pid] = (drafts[pid] || 0) + (Number(p.amount) || 0);
    else if (!lastPaid[pid]) lastPaid[pid] = { amount: Number(p.amount) || 0, date: p.date };
  });

  const rows = owing.map((r) => ({
    ...r,
    phone: phoneOf[r.id] || '',
    lastPaid: lastPaid[r.id] || null,
    draftTotal: round3(drafts[r.id] || 0),
  }));
  return { rows, total: round3(rows.reduce((s, r) => s + r.due, 0)) };
};

// status: 'draft' (Draft tab) | 'done' (Done tab) | undefined (everything,
// e.g. one customer's history).
export const fetchCustomerPayments = async ({ status, offset = 0, limit = 50, searchText = '', partnerId = null } = {}) => {
  const rows = await callKw('account.payment', 'search_read', [receiptDomain({ status, searchText, partnerId })], {
    fields: PAYMENT_FIELDS, offset, limit, order: 'date desc, id desc',
  });
  return rows || [];
};

export const countCustomerPayments = async ({ status, searchText = '', partnerId = null } = {}) => {
  const n = await callKw('account.payment', 'search_count', [receiptDomain({ status, searchText, partnerId })]);
  return Number(n) || 0;
};

export const fetchCustomerPayment = async (id) => {
  const rows = await callKw('account.payment', 'read', [[Number(id)], [...PAYMENT_FIELDS, 'partner_bank_id']]);
  if (!rows?.length) throw new PaymentReceiptError('This receipt no longer exists on the server.');
  return rows[0];
};

// Total confirmed (posted, not cancelled) receipts for one customer — the
// "Total paid" on the form's Payment History.
export const fetchCustomerPaidTotal = async (partnerId) => {
  const groups = await callKw('account.payment', 'read_group', [[
    ...receiptDomain({ status: 'done', partnerId }),
    ['state', 'in', ['in_process', 'paid']],
  ], ['amount:sum'], []], { lazy: false });
  return round3(groups?.[0]?.amount || 0);
};

export const fetchPaymentJournals = async () => {
  const rows = await callKw('account.journal', 'search_read', [[
    ['type', 'in', ['cash', 'bank']],
    ['company_id', '=', getActiveCompanyId()],
  ]], { fields: ['id', 'name', 'type', 'bank_account_id'], order: 'sequence, name' });
  return rows || [];
};

export const fetchInboundPaymentMethods = async (journalId) => {
  if (!journalId) return [];
  const rows = await callKw('account.payment.method.line', 'search_read', [[
    ['journal_id', '=', Number(journalId)],
    ['payment_type', '=', 'inbound'],
  ]], { fields: ['id', 'name'], order: 'sequence, id' });
  return rows || [];
};

// What one customer owes right now. Throws (unlike fetchPartnerOutstandingOdoo,
// which fails soft) — Confirm must not post against an unknown due.
export const fetchCustomerDue = async (partnerId) => {
  const groups = await callKw('account.move.line', 'read_group', [[
    ...receivableDomain(),
    ['partner_id', '=', Number(partnerId)],
  ], ['amount_residual:sum'], []], { lazy: false });
  return round3(groups?.[0]?.amount_residual || 0);
};

// Create (no id) or update a draft receipt. Never posts. → id
export const saveCustomerPayment = async ({ id = null, partnerId, amount, date, memo, journalId, methodLineId }) => {
  const vals = {
    amount: round3(amount),
    date,
    memo: memo || false,
    journal_id: Number(journalId),
    payment_method_line_id: Number(methodLineId),
  };
  if (id) {
    await callKw('account.payment', 'write', [[Number(id)], vals]);
    return Number(id);
  }
  return callKw('account.payment', 'create', [{
    ...vals,
    payment_type: 'inbound',
    partner_type: 'customer',
    partner_id: Number(partnerId),
  }]);
};

export const confirmCustomerPayment = async (id) => {
  await callKw('account.payment', 'action_post', [[Number(id)]]);
};
