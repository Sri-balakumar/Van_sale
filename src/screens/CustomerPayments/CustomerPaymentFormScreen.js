// One payment receipt — the app's version of the server's customer payment
// form, Payment Type fixed to Receive.
//
// Opened with { partner, amount } from a Credit Customers card (new receipt)
// or { paymentId } from the Draft / Done tabs. Drafts are editable; anything
// past draft is read-only.
//
// Like the server form: a Save button shows once something is changed, Save
// keeps the receipt as a Draft, and leaving with unsaved changes asks Save or
// Discard. Confirm double-checks in a popup, re-reads the customer's due from
// the server (the amount may never exceed it), saves and posts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import Modal from 'react-native-modal';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { showToastMessage } from '@components/Toast';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { useAuthStore } from '@stores/auth';
import { formatCurrency } from '@utils/currency';
import {
  fetchCustomerPayment, fetchCustomerPayments, fetchCustomerPaidTotal, fetchCustomerDue, fetchPaymentJournals,
  fetchInboundPaymentMethods, saveCustomerPayment, confirmCustomerPayment, m2oId, m2oName, round3,
} from '@api/services/customerPaymentsApi';
import { statusOf, fmtDate } from './receiptStatus';
import ConfirmReceiptModal from './components/ConfirmReceiptModal';
import PickerModal from './components/PickerModal';

const NAVY = COLORS.primaryThemeColor;
const ACCENT = '#DB2777';
const HISTORY_SHORT = 10;
const HISTORY_ALL = 200;
const STEPS = ['draft', 'in_process', 'paid'];

const today = () => format(new Date(), 'yyyy-MM-dd');
const sameValues = (a, b) => !!a && !!b
  && String(a.amount) === String(b.amount) && a.date === b.date && (a.memo || '') === (b.memo || '')
  && a.journalId === b.journalId && a.methodLineId === b.methodLineId;

const Field = ({ label, children, hint, hintColor }) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {children}
    {hint ? <Text style={[styles.hint, hintColor && { color: hintColor }]}>{hint}</Text> : null}
  </View>
);

// Tappable field that opens a centered PickerModal, so the fields below
// never move.
const SelectField = ({ value, placeholder, onPress, disabled }) => (
  <TouchableOpacity
    style={[styles.input, styles.dropdown, disabled && styles.readOnly]}
    activeOpacity={0.8}
    onPress={onPress}
    disabled={disabled}
  >
    <Text style={[styles.inputText, !value && { color: '#9ca3af' }]} numberOfLines={1}>{value || placeholder}</Text>
    {!disabled ? <MaterialIcons name="arrow-drop-down" size={24} color="#6b7280" /> : null}
  </TouchableOpacity>
);

const CustomerPaymentFormScreen = ({ navigation, route }) => {
  const paramPaymentId = route?.params?.paymentId || null;
  const paramPartner = route?.params?.partner || null;
  const paramAmount = route?.params?.amount;

  const currency = useAuthStore((s) => s.currency);
  const money = useCallback((v) => formatCurrency(Number(v) || 0, currency), [currency]);
  const currencyLabel = currency?.name || currency?.symbol || '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [paymentId, setPaymentId] = useState(paramPaymentId);
  const [record, setRecord] = useState(null); // { name, state, partner_bank_id } once saved
  const [partner, setPartner] = useState(paramPartner);
  const [values, setValues] = useState(null);
  const [baseline, setBaseline] = useState(null); // last saved / initial values
  const [journals, setJournals] = useState([]);
  const [methods, setMethods] = useState([]);
  const [due, setDue] = useState(null);
  const [openList, setOpenList] = useState(null); // 'journal' | 'method'
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [leaveAction, setLeaveAction] = useState(null);
  const [history, setHistory] = useState({ rows: [], paidTotal: 0, loaded: false, all: false, more: false });

  const state = record?.state || 'draft';
  const editable = state === 'draft';
  const dirty = editable && !!values && !sameValues(values, baseline);

  // ── Load ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const journalList = await fetchPaymentJournals();
      setJournals(journalList);
      let initial;
      let partnerId;
      if (paramPaymentId) {
        const p = await fetchCustomerPayment(paramPaymentId);
        setRecord({ name: p.name, state: p.state, partner_bank_id: p.partner_bank_id });
        partnerId = m2oId(p.partner_id);
        setPartner({ id: partnerId, name: m2oName(p.partner_id) });
        initial = {
          amount: String(round3(p.amount)),
          date: p.date || today(),
          memo: p.memo || '',
          journalId: m2oId(p.journal_id),
          methodLineId: m2oId(p.payment_method_line_id),
        };
        setMethods(await fetchInboundPaymentMethods(initial.journalId));
        if (p.state === 'draft') setDue(await fetchCustomerDue(partnerId));
      } else {
        partnerId = paramPartner?.id;
        const freshDue = await fetchCustomerDue(partnerId);
        setDue(freshDue);
        const journal = journalList.find((j) => j.type === 'bank') || journalList[0] || null;
        const methodList = journal ? await fetchInboundPaymentMethods(journal.id) : [];
        setMethods(methodList);
        initial = {
          amount: String(round3(freshDue > 0 ? freshDue : (paramAmount || 0))),
          date: today(),
          memo: '',
          journalId: journal?.id || null,
          methodLineId: methodList[0]?.id || null,
        };
      }
      setValues(initial);
      setBaseline(initial);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [paramPaymentId, paramPartner?.id, paramAmount]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadHistory = useCallback(async (all = false) => {
    if (!partner?.id) return;
    try {
      const limit = all ? HISTORY_ALL : HISTORY_SHORT;
      const [rows, paidTotal] = await Promise.all([
        fetchCustomerPayments({ partnerId: partner.id, limit: limit + 1 }),
        fetchCustomerPaidTotal(partner.id),
      ]);
      const others = rows.filter((r) => r.id !== paymentId);
      setHistory({ rows: others.slice(0, limit), paidTotal, loaded: true, all, more: others.length > limit });
    } catch (_) {
      setHistory((h) => ({ ...h, loaded: true }));
    }
  }, [partner?.id, paymentId]);

  useEffect(() => { loadHistory(false); }, [loadHistory]);

  // ── Validation ───────────────────────────────────────────────────────
  const amountNum = values ? round3(parseFloat(String(values.amount).replace(',', '.'))) : 0;
  const amountError = useMemo(() => {
    if (!editable || !values) return null;
    if (!Number.isFinite(amountNum) || amountNum <= 0) return 'Enter an amount more than 0.';
    if (due !== null && amountNum > due) return `Can't be more than the due (${money(due)}).`;
    return null;
  }, [editable, values, amountNum, due, money]);
  const canSubmit = editable && !!values && due !== null && !amountError
    && !!values.journalId && !!values.methodLineId && !busy;

  const setField = (key, v) => setValues((cur) => ({ ...cur, [key]: v }));

  const pickJournal = async (j) => {
    setOpenList(null);
    if (j.id === values.journalId) return;
    setValues((cur) => ({ ...cur, journalId: j.id, methodLineId: null }));
    try {
      const list = await fetchInboundPaymentMethods(j.id);
      setMethods(list);
      setValues((cur) => (cur.journalId === j.id ? { ...cur, methodLineId: list[0]?.id || null } : cur));
    } catch (e) {
      setMethods([]);
      showToastMessage(e.message);
    }
  };

  // ── Save / Confirm ───────────────────────────────────────────────────
  const save = async () => {
    const id = await saveCustomerPayment({
      id: paymentId,
      partnerId: partner.id,
      amount: amountNum,
      date: values.date,
      memo: values.memo.trim(),
      journalId: values.journalId,
      methodLineId: values.methodLineId,
    });
    setPaymentId(id);
    setRecord((r) => r || { name: false, state: 'draft' });
    setBaseline(values);
    return id;
  };

  const onSavePress = async () => {
    if (!canSubmit) {
      if (amountError) showToastMessage(amountError);
      return false;
    }
    setBusy(true);
    try {
      await save();
      showToastMessage('Saved as draft');
      return true;
    } catch (e) {
      showToastMessage(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const leaving = useRef(false);

  // Back to the list, on the tab where this receipt now lives.
  const exitTo = (tab) => {
    leaving.current = true;
    navigation.navigate('CustomerPaymentsListScreen', { tab });
  };

  const onSaveDraftPress = async () => {
    if (await onSavePress()) exitTo('draft');
  };

  const onConfirmYes = async () => {
    setBusy(true);
    try {
      // The due may have changed since the form opened (another receipt, a
      // return) — never post more than what is owed right now.
      const freshDue = await fetchCustomerDue(partner.id);
      setDue(freshDue);
      if (amountNum > freshDue) {
        setConfirmVisible(false);
        showToastMessage(`Not confirmed — the amount can't be more than the due (${money(freshDue)}).`);
        return;
      }
      const id = dirty || !paymentId ? await save() : paymentId;
      await confirmCustomerPayment(id);
      setConfirmVisible(false);
      showToastMessage('Payment receipt confirmed');
      exitTo('done');
    } catch (e) {
      setConfirmVisible(false);
      showToastMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Leaving with unsaved changes ─────────────────────────────────────
  const guardRef = useRef({ busy, dirty });
  guardRef.current = { busy, dirty };
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (leaving.current) return;
    if (guardRef.current.busy) { e.preventDefault(); return; }
    if (!guardRef.current.dirty) return;
    e.preventDefault();
    setLeaveAction(e.data.action);
  }), [navigation]);

  const leaveWith = async (doSave) => {
    const action = leaveAction;
    if (doSave && !(await onSavePress())) return;
    setLeaveAction(null);
    leaving.current = true;
    // Let the popup finish closing first.
    setTimeout(() => (doSave ? exitTo('draft') : navigation.dispatch(action)), 250);
  };

  // ── Render ───────────────────────────────────────────────────────────
  const journal = journals.find((j) => j.id === values?.journalId) || null;
  const method = methods.find((m) => m.id === values?.methodLineId) || null;
  const title = record?.name && state !== 'draft' ? record.name : (paymentId ? 'Draft Payment Receipt' : 'New Payment Receipt');
  const st = statusOf(state);
  const stepIndex = STEPS.indexOf(state);
  const bankAccount = journal?.type === 'bank'
    ? (m2oName(record?.partner_bank_id) || m2oName(journal.bank_account_id) || '—')
    : null;

  const summary = values && partner ? {
    customer: partner.name,
    amount: money(amountNum),
    date: fmtDate(values.date),
    journal: [journal?.name, method?.name].filter(Boolean).join(' · '),
    memo: values.memo.trim(),
    dueNow: money(due),
    dueAfter: money(round3((due || 0) - amountNum)),
  } : null;

  return (
    <SafeAreaView backgroundColor={NAVY}>
      <NavigationHeader
        title={title}
        onBackPress={() => navigation.goBack()}
        saveLabel={dirty ? (busy ? 'Saving…' : 'Save Draft') : undefined}
        onSavePress={busy ? () => {} : onSavePress}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={ACCENT} /></View>
      ) : loadError ? (
        <View style={styles.center}>
          <MaterialIcons name="cloud-off" size={44} color="#cbd5e1" />
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity onPress={loadAll} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={{ flex: 1, backgroundColor: '#f8fafc' }}
            contentContainerStyle={{ padding: 12, paddingBottom: editable ? 110 : 30 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Status strip */}
            {stepIndex >= 0 ? (
              <View style={styles.steps}>
                {STEPS.map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 ? <MaterialIcons name="chevron-right" size={16} color="#cbd5e1" /> : null}
                    <View style={[styles.step, i === stepIndex && { backgroundColor: statusOf(s).color }]}>
                      <Text style={[styles.stepText, i === stepIndex && { color: '#fff' }]}>{statusOf(s).label}</Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            ) : (
              <View style={[styles.cancelBadge, { backgroundColor: st.color + '20' }]}>
                <Text style={[styles.cancelBadgeText, { color: st.color }]}>{st.label}</Text>
              </View>
            )}

            <View style={styles.card}>
              <Field label="Payment Type">
                <View style={[styles.input, styles.readOnly]}>
                  <Text style={styles.inputText}>Receive</Text>
                </View>
              </Field>

              <Field
                label="Customer"
                hint={editable && due !== null ? `Current due: ${money(due)}` : null}
                hintColor="#b91c1c"
              >
                <View style={[styles.input, styles.readOnly, styles.rowCenter]}>
                  <MaterialIcons name="person" size={18} color={NAVY} />
                  <Text style={[styles.inputText, { flex: 1, fontFamily: FONT_FAMILY.urbanistBold }]} numberOfLines={1}>
                    {partner?.name || '—'}
                  </Text>
                </View>
              </Field>

              <Field label="Amount" hint={amountError} hintColor="#dc2626">
                <View style={styles.rowCenter}>
                  <TextInput
                    style={[styles.input, styles.amountInput, !editable && styles.readOnly, amountError && styles.inputError]}
                    value={values.amount}
                    onChangeText={(t) => setField('amount', t.replace(/[^0-9.,]/g, ''))}
                    keyboardType="decimal-pad"
                    editable={editable}
                    placeholder="0.000"
                    placeholderTextColor="#9ca3af"
                  />
                  {currencyLabel ? (
                    <View style={styles.currencyPill}><Text style={styles.currencyText}>{currencyLabel}</Text></View>
                  ) : null}
                </View>
              </Field>

              <Field label="Date">
                <TouchableOpacity
                  style={[styles.input, styles.dropdown, !editable && styles.readOnly]}
                  onPress={() => setDatePickerVisible(true)}
                  disabled={!editable}
                  activeOpacity={0.8}
                >
                  <Text style={styles.inputText}>{fmtDate(values.date)}</Text>
                  {editable ? <MaterialIcons name="event" size={18} color="#6b7280" /> : null}
                </TouchableOpacity>
              </Field>

              <Field label="Memo">
                <TextInput
                  style={[styles.input, !editable && styles.readOnly]}
                  value={values.memo}
                  onChangeText={(t) => setField('memo', t)}
                  editable={editable}
                  placeholder={editable ? 'Optional note, e.g. Collected at shop' : '—'}
                  placeholderTextColor="#9ca3af"
                />
              </Field>
            </View>

            <View style={styles.card}>
              <Field label="Journal">
                <SelectField
                  value={journal?.name}
                  placeholder="Select journal"
                  onPress={() => setOpenList('journal')}
                  disabled={!editable}
                />
              </Field>
              <Field label="Payment Method">
                <SelectField
                  value={method?.name}
                  placeholder="Select method"
                  onPress={() => setOpenList('method')}
                  disabled={!editable}
                />
              </Field>
              {bankAccount ? (
                <Field label="Company Bank Account">
                  <View style={[styles.input, styles.readOnly]}>
                    <Text style={styles.inputText}>{bankAccount}</Text>
                  </View>
                </Field>
              ) : null}
            </View>

            {/* Payment history for this customer */}
            <View style={styles.card}>
              <View style={styles.historyHead}>
                <Text style={styles.historyTitle}>PAYMENT HISTORY</Text>
                {history.loaded ? <Text style={styles.historyTotal}>{`Total paid ${money(history.paidTotal)}`}</Text> : null}
              </View>
              {!history.loaded ? (
                <ActivityIndicator color={ACCENT} style={{ marginVertical: 10 }} />
              ) : !history.rows.length ? (
                <Text style={styles.historyEmpty}>No other receipts for this customer.</Text>
              ) : (
                history.rows.map((h) => {
                  const hs = statusOf(h.state);
                  return (
                    <TouchableOpacity
                      key={h.id}
                      style={styles.historyRow}
                      activeOpacity={0.7}
                      onPress={() => navigation.push('CustomerPaymentFormScreen', { paymentId: h.id })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyName} numberOfLines={1}>
                          {`${fmtDate(h.date)}  ·  ${h.state === 'draft' || !h.name ? 'Draft' : h.name}`}
                        </Text>
                        <View style={[styles.badge, { backgroundColor: hs.color + '20' }]}>
                          <Text style={[styles.badgeText, { color: hs.color }]}>{hs.label}</Text>
                        </View>
                      </View>
                      <Text style={styles.historyAmount}>{money(h.amount)}</Text>
                      <MaterialIcons name="chevron-right" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  );
                })
              )}
              {history.loaded && history.more && !history.all ? (
                <TouchableOpacity onPress={() => loadHistory(true)} style={styles.showAll}>
                  <Text style={styles.showAllText}>Show all ›</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>

          {editable ? (
            <View style={[styles.bottomBar, styles.bottomRow]}>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.draftBtn, !canSubmit && { opacity: 0.5 }]}
                disabled={!canSubmit}
                onPress={() => { setOpenList(null); onSaveDraftPress(); }}
              >
                {busy && !confirmVisible ? <ActivityIndicator color={NAVY} /> : (
                  <>
                    <MaterialIcons name="save" size={20} color={NAVY} />
                    <Text style={[styles.confirmText, { color: NAVY }]}>Save Draft</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !canSubmit && { opacity: 0.5 }]}
                disabled={!canSubmit}
                onPress={() => { setOpenList(null); setConfirmVisible(true); }}
              >
                <MaterialIcons name="check-circle" size={20} color="#fff" />
                <Text style={styles.confirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      )}

      <PickerModal
        visible={!!openList}
        title={openList === 'journal' ? 'Select Journal' : 'Select Payment Method'}
        items={openList === 'journal'
          ? journals.map((j) => ({ id: j.id, label: j.name, sub: j.type === 'cash' ? 'Cash' : 'Bank', raw: j }))
          : methods.map((m) => ({ id: m.id, label: m.name }))}
        selectedId={openList === 'journal' ? values?.journalId : values?.methodLineId}
        onPick={(item) => {
          if (openList === 'journal') pickJournal(item.raw);
          else { setOpenList(null); setField('methodLineId', item.id); }
        }}
        onClose={() => setOpenList(null)}
      />

      <ConfirmReceiptModal
        visible={confirmVisible}
        summary={summary}
        posting={busy}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={onConfirmYes}
      />

      <Modal
        isVisible={!!leaveAction}
        animationIn="zoomIn"
        animationOut="zoomOut"
        backdropOpacity={0.6}
        onBackButtonPress={busy ? undefined : () => setLeaveAction(null)}
        onBackdropPress={busy ? undefined : () => setLeaveAction(null)}
      >
        <View style={styles.alertContainer}>
          <Text style={styles.alertTitle}>Unsaved changes</Text>
          <Text style={styles.alertText}>Save this receipt as a draft before leaving?</Text>
          {amountError ? <Text style={styles.alertError}>{amountError}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[styles.alertButton, { backgroundColor: '#e5e7eb' }]}
              onPress={() => leaveWith(false)}
              disabled={busy}
            >
              <Text style={[styles.alertButtonText, { color: '#111827' }]}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.alertButton, { backgroundColor: NAVY }, (!canSubmit) && { opacity: 0.5 }]}
              onPress={() => leaveWith(true)}
              disabled={!canSubmit}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.alertButtonText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DateTimePickerModal
        isVisible={datePickerVisible}
        mode="date"
        date={values?.date ? parseISO(values.date) : new Date()}
        maximumDate={new Date()}
        onConfirm={(d) => { setDatePickerVisible(false); setField('date', format(d, 'yyyy-MM-dd')); }}
        onCancel={() => setDatePickerVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 30 },
  errorText: { textAlign: 'center', color: '#6b7280', marginTop: 10, fontFamily: FONT_FAMILY.urbanistMedium, lineHeight: 19 },
  retryBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: NAVY },
  retryText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold },
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginBottom: 10 },
  step: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#E5E7EB' },
  stepText: { fontSize: 12, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistBold },
  cancelBadge: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, marginBottom: 10 },
  cancelBadgeText: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#eef0f4',
  },
  field: { marginBottom: 12 },
  label: { fontSize: 12, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 5 },
  hint: { fontSize: 12, marginTop: 5, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#6b7280' },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#111827', fontFamily: FONT_FAMILY.urbanistMedium, minHeight: 44, backgroundColor: '#fff',
  },
  inputText: { fontSize: 15, color: '#111827', fontFamily: FONT_FAMILY.urbanistMedium },
  inputError: { borderColor: '#dc2626', backgroundColor: '#FEF2F2' },
  readOnly: { backgroundColor: '#F5F6F8', justifyContent: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountInput: { flex: 1, fontSize: 18, fontFamily: FONT_FAMILY.urbanistBold },
  currencyPill: {
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, backgroundColor: '#F5F6F8', borderWidth: 1, borderColor: '#d1d5db',
  },
  currencyText: { fontSize: 13, color: '#374151', fontFamily: FONT_FAMILY.urbanistBold },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  historyTitle: { fontSize: 12, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.6 },
  historyTotal: { fontSize: 13, color: '#16a34a', fontFamily: FONT_FAMILY.urbanistBold },
  historyEmpty: { color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium, paddingVertical: 8 },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f2f6',
  },
  historyName: { fontSize: 13, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold },
  historyAmount: { fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistBold },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginTop: 4 },
  badgeText: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold },
  showAll: { paddingTop: 10, alignItems: 'center' },
  showAllText: { color: ACCENT, fontFamily: FONT_FAMILY.urbanistBold },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
  },
  confirmBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    backgroundColor: NAVY,
  },
  confirmText: { color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold },
  bottomRow: { flexDirection: 'row', gap: 10 },
  draftBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: NAVY },
  alertContainer: {
    backgroundColor: '#fff', borderRadius: 10, borderColor: NAVY, borderWidth: 2,
    paddingVertical: 22, paddingHorizontal: 14, alignItems: 'center',
  },
  alertTitle: { fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  alertText: { marginTop: 8, marginBottom: 16, fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, textAlign: 'center', color: '#4b5563' },
  alertError: { marginTop: -8, marginBottom: 14, fontSize: 12, color: '#dc2626', fontFamily: FONT_FAMILY.urbanistSemiBold, textAlign: 'center' },
  alertButton: { borderRadius: 10, padding: 14, minWidth: 110, justifyContent: 'center', alignItems: 'center' },
  alertButtonText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold },
});

export default CustomerPaymentFormScreen;
