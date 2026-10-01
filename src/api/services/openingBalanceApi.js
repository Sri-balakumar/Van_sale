// src/api/services/openingBalanceApi.js
//
// Bridge for the Odoo `opening_balance_customer_supplier` module (not shipped
// in this repo — it lives on the client server). The app feeds it the same
// Excel the accountants used to upload on the web, through the module's own
// wizard: create batch → Import from Excel (preview → import) → confirm → post.
//
// Two channels:
//   1. Salesman session — /web/dataset/call_kw with the login cookie (added by
//      authInterceptor): customer search and resolving the main admin's login.
//   2. Admin channel — stateless /jsonrpc `execute_kw` carrying the admin's
//      uid + password on every call. The import wizard needs Accounting /
//      Advisor, which a van salesman doesn't have, so everything that touches
//      the module runs here. It uses its own axios instance so the global
//      interceptor never attaches the salesman's cookie, and it never calls
//      /web/session/authenticate (that would replace the salesman's session).
//      The password is passed in by the caller and never stored here.

import axios from 'axios';
import { getOdooUrl, getOdooDb } from '@api/config/odooConfig';
import { useAuthStore } from '@stores/auth';

const MAIN_ADMIN_UID = 2;
export const ADVISOR_GROUP = 'account.group_account_manager';

export const TIMEOUT_SHORT = 15000;
export const TIMEOUT_LONG = 45000;

const BATCH = 'opening.balance';
const BATCH_LINE = 'opening.balance.line';
const WIZARD = 'opening.balance.excel.import.wizard';
const WIZARD_LINE = 'opening.balance.excel.import.wizard.line';

const BATCH_FIELDS = ['id', 'name', 'state', 'line_count', 'total_amount', 'move_id', 'date'];

// Separate instance: interceptors on the default axios instance don't apply,
// and withCredentials stays false so the native cookie jar isn't used either.
const adminHttp = axios.create({ headers: { 'Content-Type': 'application/json' } });

const MODULE_NAME = 'opening_balance_customer_supplier';

export const MISSING_MODULE_MESSAGE = "Opening balances can't be published on this server yet — the Opening "
  + "Balance feature isn't installed there. Ask your administrator to install it.";

// Error with a `kind` the publish flow acts on:
//   server         — the server answered with an error
//   missing_module — the opening-balance module isn't installed (retry can't help)
//   timeout / network — no answer; the request may still have succeeded
//   verify         — the Excel preview didn't match what was entered
export class OpeningBalanceError extends Error {
  constructor(message, kind = 'server', raw = null) {
    super(message);
    this.kind = kind;
    this.raw = raw;
  }
}

const toTransportError = (e) => {
  if (e instanceof OpeningBalanceError) return e;
  const timedOut = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
  return new OpeningBalanceError(
    timedOut
      ? 'The server is taking too long to answer.'
      : "Can't reach the server. Check the internet connection and try again.",
    timedOut ? 'timeout' : 'network',
  );
};

// The app never names the backend to users (a bare fault arrives as
// "Odoo Server Error").
const scrub = (msg) => String(msg || '')
  .replace(/odoo\s+server\s+error/gi, 'Server error')
  .replace(/\bodoo\b/gi, 'server')
  .replace(/^\s*\w/, (c) => c.toUpperCase());

// Server error → something a salesman can act on. Messages the module raises
// on purpose (UserError / ValidationError) are already written for people and
// pass through; programming errors and tracebacks don't. The raw error goes
// to the log for developers.
export const friendlyError = (err) => {
  const name = String(err?.data?.name || '');
  const raw = String(err?.data?.message || err?.message || '');
  console.warn('[OPENING_BALANCE] server error:', name, raw);
  if (/Object \S+ doesn't exist/i.test(raw)) {
    return new OpeningBalanceError(MISSING_MODULE_MESSAGE, 'missing_module', err);
  }
  if (name.endsWith('AccessError')) {
    return new OpeningBalanceError(
      "This account doesn't have permission to post opening balances. Use an admin with accounting rights.", 'server', err,
    );
  }
  if (name.endsWith('AccessDenied')) {
    return new OpeningBalanceError(
      /too many/i.test(raw) ? 'Too many wrong attempts. Wait a minute and try again.' : 'Wrong login or password.',
      'server', err,
    );
  }
  if (name.endsWith('MissingError')) {
    return new OpeningBalanceError('Something changed on the server meanwhile. Tap Retry.', 'server', err);
  }
  if ((name.endsWith('UserError') || name.endsWith('ValidationError')) && raw) {
    return new OpeningBalanceError(scrub(raw), 'server', err);
  }
  return new OpeningBalanceError(
    'Something went wrong on the server. Please try again, or contact support if it keeps happening.', 'server', err,
  );
};

const unwrap = (resp) => {
  const err = resp?.data?.error;
  if (err) throw friendlyError(err);
  return resp?.data?.result;
};

export const m2oId = (v) => {
  if (Array.isArray(v)) return v[0] || null;
  if (v && typeof v === 'object') return v.id || null;
  return v || null;
};

// Book everything to the company the salesman is working in, not the admin's
// default company (multi-company databases).
const companyContext = () => {
  const u = useAuthStore.getState().user || {};
  const raw = u.company_id ?? u.user_companies?.current_company;
  const id = Number(Array.isArray(raw) ? raw[0] : raw) || null;
  return id ? { allowed_company_ids: [id], company_id: id } : {};
};

// ── Salesman session ───────────────────────────────────────────────────

const callKw = async (model, method, args, kwargs = {}) => {
  let resp;
  try {
    resp = await axios.post(`${getOdooUrl()}/web/dataset/call_kw`, {
      jsonrpc: '2.0',
      method: 'call',
      params: { model, method, args, kwargs },
      id: Date.now(),
    }, { headers: { 'Content-Type': 'application/json' }, withCredentials: true, timeout: TIMEOUT_SHORT });
  } catch (e) {
    throw toTransportError(e);
  }
  return unwrap(resp);
};

// Whether the server has the opening-balance module, so the screen can say
// so up front instead of failing after the admin password. Readable by any
// internal user. null = couldn't tell (don't block on it).
export const isOpeningBalanceModuleInstalled = async () => {
  try {
    const n = await callKw('ir.module.module', 'search_count', [[
      ['name', '=', MODULE_NAME], ['state', '=', 'installed'],
    ]]);
    return n > 0;
  } catch (_) {
    return null;
  }
};

// The whole customer list in one request (four small fields), so the picker
// filters on the device as you type instead of waiting on the server per
// keystroke. `complete` is false when there are more than `limit` customers;
// the picker then also searches the server.
export const fetchOpeningBalanceCustomers = async (limit = 3000) => {
  const rows = await callKw('res.partner', 'search_read', [[['parent_id', '=', false]]], {
    fields: ['id', 'name', 'phone', 'city'], limit, order: 'name asc',
  });
  const list = Array.isArray(rows) ? rows : [];
  return { rows: list, complete: list.length < limit };
};

// Commercial entities only (no child contacts) — receivables sit there.
export const searchOpeningBalanceCustomers = async (term, limit = 10) => {
  const t = String(term || '').trim();
  if (!t) return [];
  const rows = await callKw('res.partner', 'search_read', [[
    ['parent_id', '=', false],
    '|', ['name', 'ilike', t], ['phone', 'ilike', t],
  ]], { fields: ['id', 'name', 'phone', 'city'], limit, order: 'name asc' });
  return Array.isArray(rows) ? rows : [];
};

export const fetchMainAdminLogin = async () => {
  try {
    const rows = await callKw('res.users', 'read', [[MAIN_ADMIN_UID], ['login']]);
    return rows?.[0]?.login || 'admin';
  } catch (_) {
    return 'admin';
  }
};

// ── Admin channel ──────────────────────────────────────────────────────

const jsonRpc = async (service, method, args, timeout) => {
  try {
    const resp = await adminHttp.post(`${getOdooUrl()}/jsonrpc`, {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now(),
    }, { timeout });
    return unwrap(resp);
  } catch (e) {
    throw toTransportError(e);
  }
};

const adminCall = (admin, model, method, args = [], kwargs = {}, timeout = TIMEOUT_SHORT) =>
  jsonRpc('object', 'execute_kw', [
    getOdooDb(), admin.uid, admin.password, model, method, args,
    { ...kwargs, context: { ...companyContext(), ...(kwargs.context || {}) } },
  ], timeout);

// Returns the admin's uid, or null when the login/password is wrong.
export const adminAuthenticate = async (login, password) => {
  const uid = await jsonRpc('common', 'authenticate', [getOdooDb(), login, password, {}], TIMEOUT_SHORT);
  return uid || null;
};

// true / false, or null when Odoo won't answer the question over RPC — the
// server's own access rules still apply to every later call in that case.
export const adminHasAdvisorRights = async (admin) => {
  try {
    return !!(await adminCall(admin, 'res.users', 'has_group', [[admin.uid], ADVISOR_GROUP]));
  } catch (e) {
    if (e.kind !== 'server') throw e;
    console.warn('[OPENING_BALANCE] has_group check unavailable:', e.message);
    return null;
  }
};

// Customers that already carry a confirmed/posted opening balance.
export const findExistingCustomerBalances = async (admin, partnerIds) => {
  if (!partnerIds.length) return [];
  const rows = await adminCall(admin, BATCH_LINE, 'search_read', [[
    ['partner_id', 'in', partnerIds],
    ['balance_type', '=', 'customer'],
    ['state', 'in', ['confirmed', 'posted']],
  ]], { fields: ['partner_id', 'amount', 'opening_balance_id', 'state'], limit: 500 });
  return Array.isArray(rows) ? rows : [];
};

export const readBatch = async (admin, id) => {
  const rows = await adminCall(admin, BATCH, 'read', [[id], BATCH_FIELDS]);
  return rows?.[0] || null;
};

// The batch is tagged with the app's publish reference in `notes`, so a
// retry after a lost response finds the same batch instead of making another.
export const findBatchByRef = async (admin, ref) => {
  const rows = await adminCall(admin, BATCH, 'search_read', [[['notes', 'ilike', ref]]], {
    fields: BATCH_FIELDS, limit: 1, order: 'id desc',
  });
  return rows?.[0] || null;
};

// Journal and opening account are "auto-selected" by the module; onchange
// returns them without saving anything, so pass them explicitly on create.
export const createCustomerBatch = async (admin, { date, notes }) => {
  const context = { default_balance_type: 'customer' };
  const spec = { balance_type: {}, date: {}, journal_id: {}, opening_account_id: {}, company_id: {} };
  const onchange = await adminCall(admin, BATCH, 'onchange', [[], {}, [], spec], { context });
  const v = onchange?.value || {};
  const vals = { balance_type: 'customer', date, notes };
  if (m2oId(v.journal_id)) vals.journal_id = m2oId(v.journal_id);
  if (m2oId(v.opening_account_id)) vals.opening_account_id = m2oId(v.opening_account_id);
  const id = await adminCall(admin, BATCH, 'create', [vals], { context });
  return Array.isArray(id) ? id[0] : id;
};

// A draft batch from an earlier, unfinished attempt is reused; keep its date
// in step with the as-on date chosen now.
export const updateBatchDate = (admin, id, date) =>
  adminCall(admin, BATCH, 'write', [[id], { date }]);

// Same as "Import from Excel" → upload → Preview on the web.
export const uploadExcelAndPreview = async (admin, { batchRecordId, asOnDate, salespersonId, fileName, base64 }) => {
  const context = {
    active_model: BATCH,
    active_id: batchRecordId,
    active_ids: [batchRecordId],
    default_opening_balance_id: batchRecordId,
  };
  const vals = {
    opening_balance_id: batchRecordId,
    as_on_date: asOnDate,
    file_name: fileName,
    file_data: base64,
    ...(salespersonId ? { salesperson_id: salespersonId } : {}),
  };
  const created = await adminCall(admin, WIZARD, 'create', [vals], { context }, TIMEOUT_LONG);
  const wizardId = Array.isArray(created) ? created[0] : created;
  await adminCall(admin, WIZARD, 'action_preview', [[wizardId]], { context }, TIMEOUT_LONG);
  return wizardId;
};

export const readPreview = async (admin, wizardId) => {
  const [wizard] = await adminCall(admin, WIZARD, 'read', [[wizardId],
    ['total_lines', 'valid_lines', 'error_lines', 'error_log', 'preview_line_ids']]);
  const ids = wizard?.preview_line_ids || [];
  const lines = ids.length
    ? await adminCall(admin, WIZARD_LINE, 'read', [ids,
      ['partner_name_raw', 'partner_id', 'ageing_bucket_label', 'amount', 'is_valid', 'error_message']])
    : [];
  return { ...wizard, lines: Array.isArray(lines) ? lines : [] };
};

// What an accountant does by hand on a red row: pick the partner, Re-validate.
export const fixPreviewPartners = async (admin, wizardId, fixes) => {
  const byPartner = new Map();
  fixes.forEach(({ lineId, partnerId }) => {
    byPartner.set(partnerId, [...(byPartner.get(partnerId) || []), lineId]);
  });
  for (const [partnerId, lineIds] of byPartner) {
    await adminCall(admin, WIZARD_LINE, 'write', [lineIds, { partner_id: partnerId }]);
  }
  await adminCall(admin, WIZARD, 'action_revalidate', [[wizardId]], {}, TIMEOUT_LONG);
};

export const importPreview = (admin, wizardId) =>
  adminCall(admin, WIZARD, 'action_import', [[wizardId]], {}, TIMEOUT_LONG);

export const confirmBatch = (admin, id) =>
  adminCall(admin, BATCH, 'action_confirm', [[id]], {}, TIMEOUT_LONG);

export const postBatch = (admin, id) =>
  adminCall(admin, BATCH, 'action_post', [[id]], {}, TIMEOUT_LONG);

export const cancelBatch = (admin, id) =>
  adminCall(admin, BATCH, 'action_cancel', [[id]], {}, TIMEOUT_LONG);
