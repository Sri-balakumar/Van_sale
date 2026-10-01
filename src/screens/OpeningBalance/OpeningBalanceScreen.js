// Opening Balance — enter old customers' credit balances from paper, by age
// bucket, and post them to Odoo through the existing opening-balance module
// (opening_balance_customer_supplier). Entries are staged on the device
// (saved as a draft, survives restarts); Publish asks for the admin password,
// builds the module's Excel and runs its import wizard all the way to a
// posted journal entry — see usePublishOpeningBalance.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Modal from 'react-native-modal';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { useFeatureHidden } from '@components/FeatureGate';
import { showToastMessage } from '@components/Toast';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { useAuthStore } from '@stores/auth';
import { getOdooDb } from '@api/config/odooConfig';
import {
  fetchMainAdminLogin, fetchOpeningBalanceCustomers, isOpeningBalanceModuleInstalled, MISSING_MODULE_MESSAGE,
} from '@api/services/openingBalanceApi';
import { formatCurrency } from '@utils/currency';
import { rowTotal, nonZeroBuckets } from '@utils/openingBalanceXlsx';
import usePublishOpeningBalance from './usePublishOpeningBalance';
import EntryModal from './components/EntryModal';
import AdminPasswordModal from './components/AdminPasswordModal';
import PublishOverlay from './components/PublishOverlay';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';
const BLUE = '#2563eb';

const today = () => format(new Date(), 'yyyy-MM-dd');
const emptyDraft = () => ({ asOnDate: today(), rows: [], pendingRef: null, rowsLocked: false });

const OpeningBalanceScreen = ({ navigation }) => {
  const user = useAuthStore((s) => s.user);
  const currency = useAuthStore((s) => s.currency);
  const canCreateCustomer = !useFeatureHidden('customers.add');
  const uid = user?.uid || user?.id;
  const draftKey = `opening_balance_draft:${getOdooDb()}:${uid}`;
  const money = useCallback((v) => formatCurrency(Number(v) || 0, currency), [currency]);

  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const draftRef = useRef(draft);
  const [entry, setEntry] = useState(null);
  const [entryVisible, setEntryVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [passwordMode, setPasswordMode] = useState(null); // 'publish' | 'discard'
  const [adminLogin, setAdminLogin] = useState('admin');
  const pendingCreate = useRef(null);
  // Customer list for the picker, loaded once when the screen opens so it is
  // ready before Add is tapped. null = not loaded (picker searches the server).
  const [customers, setCustomers] = useState(null);
  const [customersLoading, setCustomersLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(draftKey)
      .then((raw) => {
        if (!alive || !raw) return;
        const next = { ...emptyDraft(), ...JSON.parse(raw) };
        draftRef.current = next;
        setDraft(next);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    fetchMainAdminLogin().then((l) => alive && setAdminLogin(l));
    fetchOpeningBalanceCustomers()
      .then((list) => alive && setCustomers(list))
      .catch(() => {})
      .finally(() => alive && setCustomersLoading(false));
    return () => { alive = false; };
  }, [draftKey]);

  const patchDraft = useCallback(async (patch) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    try { await AsyncStorage.setItem(draftKey, JSON.stringify(next)); } catch (_) {}
  }, [draftKey]);

  const clearDraft = useCallback(async () => {
    const next = emptyDraft();
    draftRef.current = next;
    setDraft(next);
    try { await AsyncStorage.removeItem(draftKey); } catch (_) {}
  }, [draftKey]);

  const publish = usePublishOpeningBalance({
    rows: draft.rows,
    asOnDate: draft.asOnDate,
    draftMeta: { pendingRef: draft.pendingRef, rowsLocked: draft.rowsLocked },
    updateDraftMeta: patchDraft,
    salesman: { uid, name: user?.name },
  });

  // Posted: the draft is done with — clear it now, not on Done, so a killed
  // app can't come back to an already-posted list.
  useEffect(() => {
    if (publish.status === 'success') clearDraft();
  }, [publish.status, clearDraft]);

  useEffect(() => {
    if (publish.result?.discarded) {
      showToastMessage('Unfinished publish cancelled — the list can be edited again');
      publish.close();
    }
  }, [publish.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // No leaving the screen mid-publish.
  const busyRef = useRef(false);
  busyRef.current = publish.busy;
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (busyRef.current) e.preventDefault();
  }), [navigation]);

  // Whether the server has the opening-balance module. Checked on every focus
  // so it picks up an install done while the app is open. null = unknown
  // (check failed) — never blocks publishing.
  const [moduleInstalled, setModuleInstalled] = useState(null);
  const checkModule = useCallback(async () => {
    const ok = await isOpeningBalanceModuleInstalled();
    setModuleInstalled(ok);
    return ok;
  }, []);
  useFocusEffect(useCallback(() => { checkModule(); }, [checkModule]));

  const onPublishPress = async () => {
    if ((await checkModule()) === false) {
      showToastMessage(MISSING_MODULE_MESSAGE);
      return;
    }
    setPasswordMode('publish');
  };

  // Back from the customer form: reopen the entry with what was typed so far,
  // and the new customer selected if one was saved.
  useFocusEffect(useCallback(() => {
    const pc = pendingCreate.current;
    if (!pc) return;
    pendingCreate.current = null;
    if (pc.created) {
      setCustomers((c) => (c ? { ...c, rows: [...c.rows, { id: pc.created.id, name: pc.created.name }] } : c));
    }
    setEntry(pc.created
      ? { partner: { id: pc.created.id, name: pc.created.name }, values: pc.values }
      : { text: pc.name, values: pc.values });
    setEntryVisible(true);
  }, []));

  const locked = draft.rowsLocked;
  const grandTotal = useMemo(() => draft.rows.reduce((s, r) => s + rowTotal(r), 0), [draft.rows]);

  const openAdd = () => { setEntry(null); setEntryVisible(true); };
  const openEdit = (row) => { setEntry({ row }); setEntryVisible(true); };

  const onSaveRow = (row, replaceKey) => {
    const rows = [...draftRef.current.rows];
    const idx = rows.findIndex((r) => r.key === (replaceKey || row.key));
    if (idx >= 0) rows[idx] = row; else rows.push(row);
    patchDraft({ rows });
    setEntryVisible(false);
  };

  const onCreateCustomer = (name, values) => {
    pendingCreate.current = { name, values, created: null };
    setEntryVisible(false);
    // Let the entry modal finish closing before the form screen opens.
    setTimeout(() => {
      navigation.navigate('CustomerInfo', {
        details: { name },
        onSaved: (p) => {
          const id = Array.isArray(p?.id) ? p.id[0] : p?.id;
          if (pendingCreate.current && id) pendingCreate.current.created = { id, name: p.name };
        },
      });
    }, 350);
  };

  const onDelete = () => {
    patchDraft({ rows: draftRef.current.rows.filter((r) => r.key !== confirmDelete.key) });
    setConfirmDelete(null);
  };

  const onPasswordSubmit = async (login, password) => {
    const res = await publish.authorize(login, password);
    if (res.ok) {
      const mode = passwordMode;
      setPasswordMode(null);
      setTimeout(() => (mode === 'discard' ? publish.discardPending() : publish.run()), 400);
    }
    return res;
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardName} numberOfLines={1}>{item.partnerName}</Text>
        <Text style={styles.cardTotal}>{money(rowTotal(item))}</Text>
      </View>
      <View style={styles.chips}>
        {nonZeroBuckets(item).map((b) => (
          <View key={b.key} style={styles.chip}>
            <Text style={styles.chipText}>{b.label}: {money(item[b.key])}</Text>
          </View>
        ))}
      </View>
      {!locked ? (
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="edit" size={19} color={NAVY} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setConfirmDelete(item)} style={styles.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="delete-outline" size={19} color="#dc2626" />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  const header = (
    <View>
      <TouchableOpacity
        style={styles.dateRow}
        onPress={() => setDatePickerVisible(true)}
        disabled={locked}
        activeOpacity={0.7}
      >
        <MaterialIcons name="event" size={20} color={NAVY} />
        <Text style={styles.dateLabel}>Balance as on</Text>
        <Text style={styles.dateValue}>{format(parseISO(draft.asOnDate), 'dd MMM yyyy')}</Text>
        {!locked ? <MaterialIcons name="edit" size={16} color="#9ca3af" /> : null}
      </TouchableOpacity>

      <View style={styles.summary}>
        <View>
          <Text style={styles.summaryLabel}>Customers</Text>
          <Text style={styles.summaryValue}>{draft.rows.length}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{money(grandTotal)}</Text>
        </View>
      </View>

      {moduleInstalled === false ? (
        <View style={[styles.banner, styles.bannerInfo]}>
          <MaterialIcons name="info-outline" size={20} color={BLUE} />
          <Text style={[styles.bannerText, styles.bannerInfoText]}>
            Publishing isn't available yet. The Opening Balance feature isn't installed on the server — ask your
            administrator. You can still enter balances; they're kept on this phone.
          </Text>
        </View>
      ) : null}

      {locked ? (
        <View style={styles.banner}>
          <MaterialIcons name="sync-problem" size={20} color={ORANGE} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerText}>
              The last publish didn't finish. The list is locked until it does — tap Resume.
            </Text>
            <TouchableOpacity onPress={() => setPasswordMode('discard')}>
              <Text style={styles.bannerLink}>Start over instead</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView backgroundColor={NAVY}>
      <NavigationHeader title="Opening Balance" onBackPress={() => navigation.goBack()} />
      {!loaded ? (
        <View style={styles.center}><ActivityIndicator size="large" color={ORANGE} /></View>
      ) : (
        <FlatList
          data={draft.rows}
          keyExtractor={(it) => it.key}
          renderItem={renderItem}
          style={{ backgroundColor: '#f8fafc' }}
          contentContainerStyle={{ padding: 12, paddingBottom: 170 }}
          ListHeaderComponent={header}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <MaterialIcons name="account-balance-wallet" size={44} color="#cbd5e1" />
              <Text style={styles.emptyText}>No customers yet. Tap “Add” to enter a balance from the paper records.</Text>
            </View>
          )}
        />
      )}

      {loaded && !locked ? (
        <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={openAdd}>
          <MaterialIcons name="add" size={26} color="#fff" />
          <Text style={styles.fabText}>Add</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.publishBtn, (!draft.rows.length || publish.busy || moduleInstalled === false) && { opacity: 0.5 }]}
          disabled={!draft.rows.length || publish.busy || moduleInstalled === false}
          onPress={onPublishPress}
        >
          <MaterialIcons name={locked ? 'sync' : 'cloud-upload'} size={20} color="#fff" />
          <Text style={styles.publishText}>
            {moduleInstalled === false ? 'Publish unavailable' : locked ? 'Resume publish' : 'Publish'}
          </Text>
        </TouchableOpacity>
      </View>

      <EntryModal
        visible={entryVisible}
        initial={entry}
        stagedRows={draft.rows}
        canCreate={canCreateCustomer}
        customers={customers}
        customersLoading={customersLoading}
        money={money}
        onSave={onSaveRow}
        onCancel={() => setEntryVisible(false)}
        onCreateCustomer={onCreateCustomer}
      />

      <AdminPasswordModal
        visible={!!passwordMode}
        title={passwordMode === 'discard' ? 'Start over' : 'Admin password'}
        message={passwordMode === 'discard'
          ? 'Cancels the unfinished upload on the server (unless it was already posted) and unlocks the list.'
          : `Posts ${draft.rows.length} customer balance${draft.rows.length === 1 ? '' : 's'} (total ${money(grandTotal)}) to the accounts as a journal entry.`}
        defaultLogin={adminLogin}
        onSubmit={onPasswordSubmit}
        onCancel={() => setPasswordMode(null)}
      />

      <PublishOverlay
        status={publish.status}
        step={publish.step}
        stepStartedAt={publish.stepStartedAt}
        error={publish.error}
        retryable={publish.retryable}
        result={publish.result}
        conflicts={publish.conflicts}
        money={money}
        onConflicts={publish.resolveConflicts}
        onRetry={publish.retry}
        onClose={publish.close}
        onDone={() => { publish.close(); navigation.goBack(); }}
      />

      <DateTimePickerModal
        isVisible={datePickerVisible}
        mode="date"
        date={parseISO(draft.asOnDate)}
        maximumDate={new Date()}
        onConfirm={(d) => { setDatePickerVisible(false); patchDraft({ asOnDate: format(d, 'yyyy-MM-dd') }); }}
        onCancel={() => setDatePickerVisible(false)}
      />

      <Modal
        isVisible={!!confirmDelete}
        animationIn="zoomIn"
        animationOut="zoomOut"
        backdropOpacity={0.6}
        onBackButtonPress={() => setConfirmDelete(null)}
        onBackdropPress={() => setConfirmDelete(null)}
      >
        <View style={styles.alertContainer}>
          <Text style={styles.alertText}>Remove “{confirmDelete?.partnerName}” from the list?</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[styles.alertButton, { backgroundColor: '#e5e7eb' }]} onPress={() => setConfirmDelete(null)}>
              <Text style={[styles.alertButtonText, { color: '#111827' }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.alertButton, { backgroundColor: '#dc2626' }]} onPress={onDelete}>
              <Text style={styles.alertButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: '#eef0f4',
  },
  dateLabel: { flex: 1, fontSize: 13, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistSemiBold },
  dateValue: { fontSize: 15, color: '#111827', fontFamily: FONT_FAMILY.urbanistBold },
  summary: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: NAVY, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, marginTop: 10, marginBottom: 12,
  },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: FONT_FAMILY.urbanistMedium },
  summaryValue: { fontSize: 18, color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 2 },
  banner: {
    flexDirection: 'row', gap: 10, backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1,
    borderRadius: 12, padding: 12, marginBottom: 12,
  },
  bannerInfo: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  bannerInfoText: { flex: 1, color: '#1e40af' },
  bannerText: { fontSize: 13, color: '#9a3412', fontFamily: FONT_FAMILY.urbanistSemiBold, lineHeight: 18 },
  bannerLink: { fontSize: 13, color: ORANGE, fontFamily: FONT_FAMILY.urbanistBold, marginTop: 6 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eef0f4',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardName: { flex: 1, fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  cardTotal: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: NAVY },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  chipText: { fontSize: 12, color: '#334155', fontFamily: FONT_FAMILY.urbanistSemiBold },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  iconBtn: { padding: 6, marginLeft: 4 },
  empty: { alignItems: 'center', marginTop: 40, paddingHorizontal: 30 },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 10, fontFamily: FONT_FAMILY.urbanistMedium, lineHeight: 19 },
  fab: {
    position: 'absolute', right: 18, bottom: 92, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: ORANGE, borderRadius: 28, paddingVertical: 12, paddingHorizontal: 18,
    shadowColor: ORANGE, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 2 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
  },
  publishBtn: {
    paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    backgroundColor: NAVY,
  },
  publishText: { color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold },
  alertContainer: {
    backgroundColor: '#fff', borderRadius: 10, borderColor: NAVY, borderWidth: 2,
    paddingVertical: 22, paddingHorizontal: 14, alignItems: 'center',
  },
  alertText: { marginVertical: 16, fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, textAlign: 'center' },
  alertButton: { borderRadius: 10, padding: 14, minWidth: 110, justifyContent: 'center', alignItems: 'center' },
  alertButtonText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold },
});

export default OpeningBalanceScreen;
