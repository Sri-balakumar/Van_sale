// src/api/services/deviceApi.js
// Wraps all Odoo device_login_config endpoints.
// All endpoints are JSON-RPC, auth='none', no CSRF required.
//
// NOTE: Uses bare `axios` (not the configured app axios instance) on purpose:
//   - The auth interceptor would attach a session cookie that's irrelevant
//     to these endpoints.
//   - The network-error interceptor would pop the offline modal during normal
//     "device not registered yet" paths.
// Keeping these endpoints isolated is intentional.

import axios from 'axios';

const JSONRPC_HEADERS = { 'Content-Type': 'application/json' };
const TIMEOUT_MS = 10000; // 10 second timeout for all device API calls
const DEFAULT_DEVICE_NAME = 'NEXGENN Van-Sale';

function normalizeUrl(baseUrl = '') {
  let url = baseUrl.trim();
  // Prepend http:// if no protocol present
  if (url && !url.startsWith('http')) {
    url = 'http://' + url;
  }
  // Remove trailing slash(es)
  return url.replace(/\/+$/, '');
}

function jsonrpcBody(params) {
  return { jsonrpc: '2.0', method: 'call', params };
}

/**
 * Fetch available databases from the Odoo server.
 * Tries multiple endpoints — never throws (returns [] on any failure).
 * @param {string} baseUrl
 * @returns {Promise<string[]>} array of database names
 */
export async function fetchDatabases(baseUrl) {
  const base = normalizeUrl(baseUrl);
  const opts = { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS };
  let lastError = null;

  // 1. Try custom module endpoint first
  try {
    const res = await axios.post(`${base}/device/databases`, jsonrpcBody({}), opts);
    const dbs = res.data?.result?.databases;
    if (Array.isArray(dbs) && dbs.length > 0) return dbs;
  } catch (err) {
    console.warn('[fetchDatabases] /device/databases failed:', err.message);
    lastError = err;
  }

  // 2. Try Odoo's built-in /web/database/list (all Odoo versions)
  try {
    const res = await axios.post(`${base}/web/database/list`, jsonrpcBody({}), opts);
    if (res.data?.error) throw new Error(res.data.error.data?.message || 'list disabled');
    const result = res.data?.result;
    if (Array.isArray(result) && result.length > 0) return result;
    if (Array.isArray(result?.databases) && result.databases.length > 0) return result.databases;
  } catch (err) {
    console.warn('[fetchDatabases] /web/database/list POST failed:', err.message);
    lastError = err;
  }

  // 3. Try /web/database/list as a plain GET (some proxy setups)
  try {
    const res = await axios.get(`${base}/web/database/list`, { timeout: TIMEOUT_MS });
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.data?.result)) return res.data.result;
  } catch (err) {
    console.warn('[fetchDatabases] /web/database/list GET failed:', err.message);
    lastError = err;
  }

  if (lastError) throw lastError;
  return [];
}

/**
 * Unified startup/registration endpoint.
 * - Already registered → { registered: true }
 * - New device, auto-registered → { registered: false, just_registered: true }
 * - Error → { registered: false, error: "..." }
 */
export async function initDevice({ baseUrl, databaseName, deviceId, deviceName }) {
  const url = `${normalizeUrl(baseUrl)}/device/init`;
  const res = await axios.post(
    url,
    jsonrpcBody({
      base_url: normalizeUrl(baseUrl),
      database_name: databaseName,
      device_id: deviceId,
      device_name: deviceName || DEFAULT_DEVICE_NAME,
    }),
    { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
  );
  return res.data?.result || { registered: false, error: 'Empty response from server' };
}

/**
 * End a device's session — flips an 'active' record to 'deactivated' in Odoo.
 * Called when the app re-enters Device Setup so the device must re-scan its QR.
 * Never throws (returns { success: false } on any failure).
 */
export async function deactivateDevice({ baseUrl, databaseName, deviceId }) {
  const url = `${normalizeUrl(baseUrl)}/device/deactivate`;
  console.log('[DEVICE] deactivateDevice -> calling', { url, databaseName, deviceId });
  try {
    const res = await axios.post(
      url,
      jsonrpcBody({ device_id: deviceId, database_name: databaseName }),
      { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
    );
    const result = res.data?.result || { success: false };
    console.log('[DEVICE] deactivateDevice <- response', result);
    return result;
  } catch (err) {
    console.log('[DEVICE] deactivateDevice <- error', err?.message || err);
    return { success: false };
  }
}

/**
 * Check if a device is already registered.
 */
export async function checkDevice({ baseUrl, deviceId, databaseName }) {
  const url = `${normalizeUrl(baseUrl)}/device/check`;
  const res = await axios.post(
    url,
    jsonrpcBody({ device_id: deviceId, database_name: databaseName }),
    { headers: JSONRPC_HEADERS }
  );
  return res.data?.result || { registered: false };
}

/**
 * Register an app device explicitly (alternative to initDevice).
 */
export async function registerDevice({ baseUrl, databaseName, deviceId, deviceName }) {
  const url = `${normalizeUrl(baseUrl)}/device/register/app`;
  const res = await axios.post(
    url,
    jsonrpcBody({
      base_url: normalizeUrl(baseUrl),
      database_name: databaseName,
      device_id: deviceId,
      device_name: deviceName || DEFAULT_DEVICE_NAME,
    }),
    { headers: JSONRPC_HEADERS }
  );
  return res.data?.result || { success: false, error: 'Empty response from server' };
}

/**
 * Register device via QR scan — creates/updates device.registry record.
 * Called after app scans the QR shown in Odoo New Device form.
 */
export async function registerFromScan({ baseUrl, databaseName, deviceId, deviceName, recordId }) {
  const base = normalizeUrl(baseUrl);
  const res = await axios.post(
    `${base}/device/register-from-scan`,
    jsonrpcBody({
      device_id: deviceId,
      device_name: deviceName || DEFAULT_DEVICE_NAME,
      database_name: databaseName,
      base_url: base,
      record_id: recordId || null,
    }),
    { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
  );
  return res.data?.result || { status: 'error', message: 'Empty response from server' };
}

/**
 * Authenticate with Odoo and return session info.
 */
export async function authenticate(baseUrl, db, login, password) {
  const base = normalizeUrl(baseUrl);
  const res = await axios.post(
    `${base}/web/session/authenticate`,
    jsonrpcBody({ db, login, password }),
    { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
  );
  return res.data?.result || { uid: false };
}

/**
 * Check if a module is installed in the given Odoo database.
 * Requires an authenticated session (call authenticate first).
 */
export async function isModuleInstalled(baseUrl, db, uid, password, moduleName) {
  const base = normalizeUrl(baseUrl);
  const res = await axios.post(
    `${base}/jsonrpc`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          db,
          uid,
          password,
          'ir.module.module',
          'search_count',
          [[['name', '=', moduleName], ['state', '=', 'installed']]],
        ],
      },
    },
    { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
  );
  return (res.data?.result || 0) > 0;
}

/**
 * Step 1 — Check if this device UUID is pre-registered in Odoo.
 * Admin must have created a device.registry record with mac_address = deviceUUID.
 *
 * Response: { status: 'found'|'not_found'|'error', device_name?, device_status? }
 */
export async function lookupDevice(baseUrl, deviceUUID, databaseName) {
  const base = normalizeUrl(baseUrl);
  const res = await axios.post(
    `${base}/device/lookup`,
    jsonrpcBody({ mac_address: deviceUUID, database_name: databaseName }),
    { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
  );
  return res.data?.result || { status: 'error', message: 'Empty response from server' };
}

/**
 * Step 2 — Activate a pre-registered device (link UUID, mark Active).
 * Call only after lookupDevice returns status='found'.
 *
 * Response: { status: 'activated'|'already_active'|'blocked'|'not_found'|'error' }
 */
export async function activateDevice(baseUrl, deviceUUID, databaseName) {
  const base = normalizeUrl(baseUrl);
  const res = await axios.post(
    `${base}/device/activate`,
    jsonrpcBody({
      mac_address: deviceUUID,
      database_name: databaseName,
      device_id: deviceUUID,
      base_url: base,
    }),
    { headers: JSONRPC_HEADERS, timeout: TIMEOUT_MS }
  );
  return res.data?.result || { status: 'error', message: 'Empty response from server' };
}
