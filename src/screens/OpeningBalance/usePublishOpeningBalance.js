// Publish pipeline for the Opening Balance screen.
//
// Mirrors what an accountant does on the Odoo web, through the module's own
// Excel wizard: batch → upload + Preview → (fix red rows, Re-validate) →
// Import Lines → Confirm → Post Journal Entry. Every step runs with the admin
// credentials entered in the password dialog (held in a ref for this publish
// only — never persisted).
//
// Resume-safe: each publish gets a reference (`pendingRef`, saved with the
// draft) that is written into the batch's notes. Every run starts by looking
// that batch up and only does the steps its server state still needs, so a
// Retry after a timeout never creates a second batch or posts twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  adminAuthenticate, adminHasAdvisorRights, findExistingCustomerBalances, findBatchByRef,
  createCustomerBatch, updateBatchDate, readBatch, uploadExcelAndPreview, readPreview,
  fixPreviewPartners, importPreview, confirmBatch, postBatch, cancelBatch, m2oId,
  OpeningBalanceError,
} from '@api/services/openingBalanceApi';
import {
  buildOpeningBalanceXlsx, partnerCellNames, normalizeName, rowTotal, nonZeroBuckets,
} from '@utils/openingBalanceXlsx';
import { generateUUIDv4 } from '@utils/uuid';

export const STEP_TEXT = {
  checking: 'Checking existing balances…',
  batch: 'Preparing opening balance batch…',
  generating: 'Generating Excel file…',
  uploading: 'Uploading…',
  verifying: 'Verifying customers and amounts…',
  importing: 'Importing lines…',
  posting: 'Posting journal entry…',
};

const sameAmount = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

const makeRef = () => `OB-${format(new Date(), 'yyyyMMddHHmmss')}-${generateUUIDv4().slice(0, 4).toUpperCase()}`;

// Reads the wizard preview and checks it line by line against what the user
// staged — the in-app version of the web's green/red review.
const verifyPreview = async (admin, wizardId, rows) => {
  const cellNames = partnerCellNames(rows);
  const expected = new Map();
  rows.forEach((r) => {
    expected.set(normalizeName(cellNames.get(r.partnerId)), {
      partnerId: r.partnerId, name: r.partnerName, total: rowTotal(r), count: nonZeroBuckets(r).length,
    });
  });

  let preview = await readPreview(admin, wizardId);
  const fixes = [];
  for (const line of preview.lines) {
    const exp = expected.get(normalizeName(line.partner_name_raw));
    if (!exp) {
      throw new OpeningBalanceError(`Nothing was imported — the server read an unexpected row "${line.partner_name_raw}".`, 'verify');
    }
    if (m2oId(line.partner_id) !== exp.partnerId) fixes.push({ lineId: line.id, partnerId: exp.partnerId });
  }
  if (fixes.length) {
    await fixPreviewPartners(admin, wizardId, fixes);
    preview = await readPreview(admin, wizardId);
  }

  const problems = [];
  preview.lines.filter((l) => !l.is_valid).forEach((l) => {
    problems.push(`${l.partner_name_raw} (${l.ageing_bucket_label || '?'}): ${l.error_message || 'invalid'}`);
  });
  for (const [key, exp] of expected) {
    const lines = preview.lines.filter((l) => normalizeName(l.partner_name_raw) === key);
    const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    if (lines.length !== exp.count || !sameAmount(sum, exp.total)) {
      problems.push(`${exp.name}: the server read ${lines.length} line(s) totalling ${sum}, expected ${exp.count} totalling ${exp.total}`);
    } else if (lines.some((l) => m2oId(l.partner_id) !== exp.partnerId)) {
      problems.push(`${exp.name}: customer could not be matched`);
    }
  }
  if (preview.error_log) problems.push(String(preview.error_log).trim());
  if (!problems.length && preview.error_lines > 0) problems.push(`${preview.error_lines} row(s) have errors`);
  if (problems.length) {
    throw new OpeningBalanceError(
      `Nothing was imported — the Excel check failed:\n• ${problems.slice(0, 6).join('\n• ')}`,
      'verify',
    );
  }
};

const usePublishOpeningBalance = ({ rows, asOnDate, draftMeta, updateDraftMeta, salesman }) => {
  const [status, setStatus] = useState('idle'); // idle | running | confirming | success | error | unknown
  const [step, setStep] = useState(null);
  const [stepStartedAt, setStepStartedAt] = useState(null);
  const [error, setError] = useState(null);
  // false when retrying cannot help (e.g. the module is not installed).
  const [retryable, setRetryable] = useState(true);
  const [result, setResult] = useState(null);
  const [conflicts, setConflicts] = useState([]);

  const adminRef = useRef(null);
  const inFlightRef = useRef(false);
  const lastActionRef = useRef(null);
  const conflictResolverRef = useRef(null);
  const conflictsAcceptedRef = useRef(false);

  // Latest inputs, so async steps never act on a stale render's values.
  const inputsRef = useRef({});
  inputsRef.current = { rows, asOnDate, draftMeta, updateDraftMeta, salesman };

  const wipeCredentials = useCallback(() => {
    adminRef.current = null;
    conflictsAcceptedRef.current = false;
  }, []);

  useEffect(() => wipeCredentials, [wipeCredentials]);

  const go = (s) => { setStep(s); setStepStartedAt(Date.now()); };

  const authorize = useCallback(async (login, password) => {
    try {
      const uid = await adminAuthenticate(login, password);
      if (!uid) return { ok: false, wrongPassword: true, error: 'Wrong password.' };
      const admin = { login, uid, password };
      const rights = await adminHasAdvisorRights(admin);
      if (rights === false) {
        return { ok: false, error: `"${login}" doesn't have Accounting / Advisor rights, which the import needs.` };
      }
      adminRef.current = admin;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'Could not reach the server.' };
    }
  }, []);

  const askConflicts = (list) => new Promise((resolve) => {
    conflictResolverRef.current = resolve;
    setConflicts(list);
    setStatus('confirming');
  });

  const resolveConflicts = useCallback((accepted) => {
    const resolve = conflictResolverRef.current;
    conflictResolverRef.current = null;
    if (resolve) resolve(accepted);
  }, []);

  const fail = (e, wrote) => {
    setError(e?.message || 'Publish failed');
    setRetryable(e?.kind !== 'missing_module');
    setStatus((e?.kind === 'timeout' || e?.kind === 'network') && wrote ? 'unknown' : 'error');
  };

  const run = useCallback(async () => {
    const admin = adminRef.current;
    if (inFlightRef.current || !admin) return;
    inFlightRef.current = true;
    lastActionRef.current = 'run';
    setError(null);
    setStatus('running');
    let wrote = false;
    const { rows: list, asOnDate: date, draftMeta: meta, updateDraftMeta: updateMeta, salesman: me } = inputsRef.current;
    const grandTotal = list.reduce((s, r) => s + rowTotal(r), 0);
    try {
      if (!meta.rowsLocked && !conflictsAcceptedRef.current) {
        go('checking');
        const found = await findExistingCustomerBalances(admin, list.map((r) => r.partnerId));
        if (found.length) {
          const accepted = await askConflicts(found);
          if (!accepted) {
            wipeCredentials();
            setStatus('idle');
            return;
          }
          conflictsAcceptedRef.current = true;
          setStatus('running');
        }
      }

      let ref = meta.pendingRef;
      if (!ref) {
        ref = makeRef();
        await updateMeta({ pendingRef: ref });
      }

      go('batch');
      let batch = await findBatchByRef(admin, ref);
      if (batch?.state === 'cancelled') {
        // Cancelled in Odoo meanwhile — nothing of it was posted; start fresh.
        ref = makeRef();
        await updateMeta({ pendingRef: ref, rowsLocked: false });
        batch = null;
      }
      if (!batch) {
        wrote = true;
        const id = await createCustomerBatch(admin, {
          date,
          notes: `Van Sale app upload ${ref} · entered by ${me?.name || 'salesman'}`,
        });
        batch = await readBatch(admin, id);
      }

      if (batch.state === 'draft' && !batch.line_count) {
        if (batch.date !== date) {
          wrote = true;
          await updateBatchDate(admin, batch.id, date);
        }
        go('generating');
        const file = buildOpeningBalanceXlsx(list, ref);

        go('uploading');
        wrote = true;
        const wizardId = await uploadExcelAndPreview(admin, {
          batchRecordId: batch.id,
          asOnDate: date,
          salespersonId: me?.uid || null,
          fileName: file.fileName,
          base64: file.base64,
        });

        go('verifying');
        await verifyPreview(admin, wizardId, list);

        go('importing');
        // From here the batch may hold these exact lines, so the list is
        // frozen until the publish completes or is discarded.
        await updateMeta({ rowsLocked: true });
        await importPreview(admin, wizardId);
        batch = await readBatch(admin, batch.id);
      }

      if (!sameAmount(batch.total_amount, grandTotal)) {
        throw new OpeningBalanceError(
          `Batch ${batch.name} holds ${batch.total_amount} but the list totals ${grandTotal}. It was not posted — please contact your administrator.`,
        );
      }

      go('posting');
      if (batch.state === 'draft') {
        wrote = true;
        await confirmBatch(admin, batch.id);
        batch = await readBatch(admin, batch.id);
      }
      if (batch.state === 'confirmed') {
        wrote = true;
        await postBatch(admin, batch.id);
        batch = await readBatch(admin, batch.id);
      }
      if (batch.state !== 'posted') {
        throw new OpeningBalanceError(`Batch ${batch.name} is "${batch.state}", expected Posted.`);
      }

      setResult({
        batchName: batch.name,
        moveName: Array.isArray(batch.move_id) ? batch.move_id[1] : null,
        customers: list.length,
        total: batch.total_amount,
      });
      wipeCredentials();
      setStatus('success');
    } catch (e) {
      fail(e, wrote);
    } finally {
      inFlightRef.current = false;
    }
  }, [wipeCredentials]);

  // "Start over" for a publish that may have reached Odoo. Checks the batch
  // first: if it already got posted, that's a success, not something to redo.
  const discardPending = useCallback(async () => {
    const admin = adminRef.current;
    if (inFlightRef.current || !admin) return;
    inFlightRef.current = true;
    lastActionRef.current = 'discard';
    setError(null);
    setStatus('running');
    go('checking');
    const { draftMeta: meta, updateDraftMeta: updateMeta, rows: list } = inputsRef.current;
    let wrote = false;
    try {
      const batch = meta.pendingRef ? await findBatchByRef(admin, meta.pendingRef) : null;
      if (batch?.state === 'posted') {
        setResult({
          batchName: batch.name,
          moveName: Array.isArray(batch.move_id) ? batch.move_id[1] : null,
          customers: list.length,
          total: batch.total_amount,
          alreadyPosted: true,
        });
        wipeCredentials();
        setStatus('success');
        return;
      }
      if (batch && (batch.state === 'draft' || batch.state === 'confirmed')) {
        wrote = true;
        await cancelBatch(admin, batch.id);
      }
      await updateMeta({ pendingRef: null, rowsLocked: false });
      wipeCredentials();
      setStatus('idle');
      setResult({ discarded: true });
    } catch (e) {
      fail(e, wrote);
    } finally {
      inFlightRef.current = false;
    }
  }, [wipeCredentials]);

  const retry = useCallback(() => {
    if (lastActionRef.current === 'discard') return discardPending();
    return run();
  }, [run, discardPending]);

  const close = useCallback(() => {
    if (inFlightRef.current) return;
    wipeCredentials();
    setError(null);
    setResult(null);
    setConflicts([]);
    setStatus('idle');
  }, [wipeCredentials]);

  return {
    status, step, stepStartedAt, error, retryable, result, conflicts,
    busy: status === 'running' || status === 'confirming',
    authorize, run, discardPending, retry, close, resolveConflicts,
  };
};

export default usePublishOpeningBalance;
