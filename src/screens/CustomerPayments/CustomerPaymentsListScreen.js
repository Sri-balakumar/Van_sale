// Accounting → Payment Receipts. Money received from customers, in three tabs:
//   Credit Customers — who still owes (due > 0); tap one to take a receipt
//   Draft            — receipts saved but not confirmed yet
//   Done             — confirmed receipts (In Process / Paid / Cancelled)
// There is no Add button: a receipt always starts from a credit customer.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView, RoundedContainer, SearchContainer } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { showToastMessage } from '@components/Toast';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { useAuthStore } from '@stores/auth';
import { formatCurrency } from '@utils/currency';
import {
  fetchCreditCustomers, fetchCustomerPayments, countCustomerPayments, m2oName,
} from '@api/services/customerPaymentsApi';
import { statusOf, fmtDate } from './receiptStatus';

const NAVY = COLORS.primaryThemeColor;
const ACCENT = '#DB2777';
const PAGE = 50;

const TABS = [
  { key: 'credit', label: 'Credit Customers' },
  { key: 'draft', label: 'Draft' },
  { key: 'done', label: 'Done' },
];

const CustomerPaymentsListScreen = ({ navigation, route }) => {
  const currency = useAuthStore((s) => s.currency);
  const money = useCallback((v) => formatCurrency(Number(v) || 0, currency), [currency]);

  const [tab, setTab] = useState('credit');
  const [query, setQuery] = useState('');
  const [searchText, setSearchText] = useState('');
  const [rows, setRows] = useState([]);
  const [creditTotal, setCreditTotal] = useState(0);
  const [counts, setCounts] = useState({ credit: null, draft: null, done: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearchText(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const loadCounts = useCallback(async (q) => {
    try {
      const [draft, done] = await Promise.all([
        countCustomerPayments({ status: 'draft', searchText: q }),
        countCustomerPayments({ status: 'done', searchText: q }),
      ]);
      setCounts((c) => ({ ...c, draft, done }));
    } catch (_) { /* counts are a nicety */ }
  }, []);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    loadCounts(searchText);
    try {
      if (tab === 'credit') {
        const res = await fetchCreditCustomers({ searchText });
        if (id !== requestId.current) return;
        setRows(res.rows);
        setCreditTotal(res.total);
        setHasMore(false);
        setCounts((c) => ({ ...c, credit: res.rows.length }));
      } else {
        const list = await fetchCustomerPayments({ status: tab, offset: 0, limit: PAGE, searchText });
        if (id !== requestId.current) return;
        setRows(list);
        setHasMore(list.length === PAGE);
      }
    } catch (e) {
      if (id !== requestId.current) return;
      setRows([]);
      setError(e.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [tab, searchText, loadCounts]);

  // Reload on focus too, so a receipt just saved or confirmed shows at once.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (tab === 'credit' || loading || loadingMore || !hasMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const list = await fetchCustomerPayments({ status: tab, offset: rows.length, limit: PAGE, searchText });
      if (id !== requestId.current) return;
      setRows((prev) => [...prev, ...list]);
      setHasMore(list.length === PAGE);
    } catch (e) {
      showToastMessage(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const switchTab = (key) => {
    if (key === tab) return;
    requestId.current += 1;
    setRows([]);
    setTab(key);
  };

  // The form sends us back with { tab } after Save Draft / Confirm so the
  // receipt shows where it now lives. Cleared so later taps aren't overridden.
  const requestedTab = route?.params?.tab;
  useEffect(() => {
    if (!requestedTab) return;
    switchTab(requestedTab);
    navigation.setParams({ tab: undefined });
  }, [requestedTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCredit = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('CustomerPaymentFormScreen', {
        partner: { id: item.id, name: item.name }, amount: item.due,
      })}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconDisk, { backgroundColor: '#FDF2F8' }]}>
          <MaterialIcons name="person" size={22} color={ACCENT} />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.number} numberOfLines={1}>{item.name}</Text>
          {item.phone ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={13} color="#6b7280" />
              <Text style={styles.detailText}>{item.phone}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.dueLabel}>Due</Text>
          <Text style={[styles.total, { color: '#b91c1c' }]}>{money(item.due)}</Text>
        </View>
      </View>
      {item.lastPaid || item.draftTotal > 0 ? (
        <View style={styles.detailSection}>
          {item.lastPaid ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="history" size={14} color="#6b7280" />
              <Text style={styles.detailText}>
                {`Last paid ${money(item.lastPaid.amount)} · ${fmtDate(item.lastPaid.date)}`}
              </Text>
            </View>
          ) : null}
          {item.draftTotal > 0 ? (
            <View style={[styles.chip, { backgroundColor: '#F3F4F6', borderColor: '#D1D5DB' }]}>
              <MaterialIcons name="edit-note" size={13} color="#4b5563" />
              <Text style={[styles.chipText, { color: '#4b5563' }]}>{`Draft ${money(item.draftTotal)}`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const renderReceipt = ({ item }) => {
    const st = statusOf(item.state);
    const method = m2oName(item.payment_method_line_id);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('CustomerPaymentFormScreen', { paymentId: item.id })}
      >
        <View style={styles.headerRow}>
          <View style={[styles.iconDisk, { backgroundColor: st.color + '1A' }]}>
            <MaterialIcons name="payments" size={22} color={st.color} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.number} numberOfLines={1}>
              {item.state === 'draft' || !item.name ? 'Draft' : item.name}
            </Text>
            <View style={[styles.badge, { backgroundColor: st.color + '20' }]}>
              <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>
          <Text style={styles.total}>{money(item.amount)}</Text>
        </View>
        <View style={styles.detailSection}>
          <View style={styles.detailRow}>
            <MaterialIcons name="person" size={14} color="#6b7280" />
            <Text style={styles.detailText}>{m2oName(item.partner_id) || '—'}</Text>
          </View>
          <View style={styles.detailRow}>
            <MaterialIcons name="event" size={14} color="#6b7280" />
            <Text style={styles.detailText}>{fmtDate(item.date)}</Text>
          </View>
          <View style={styles.detailRow}>
            <MaterialIcons name="account-balance" size={14} color="#6b7280" />
            <Text style={styles.detailText}>
              {[m2oName(item.journal_id), method].filter(Boolean).join(' · ') || '—'}
            </Text>
          </View>
          {item.memo ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="notes" size={14} color="#6b7280" />
              <Text style={styles.detailText} numberOfLines={2}>{item.memo}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const emptyText = error
    || (tab === 'credit'
      ? (searchText ? 'No customer with a due matches the search.' : 'No customer owes anything right now.')
      : tab === 'draft'
        ? 'No draft receipts. Receipts you save without confirming show here.'
        : 'No confirmed receipts yet.');

  return (
    <SafeAreaView>
      <NavigationHeader title="Payment Receipts" onBackPress={() => navigation.goBack()} />
      <SearchContainer
        placeholder={tab === 'credit' ? 'Search customer or phone' : 'Search receipt # or customer'}
        onChangeText={setQuery}
      />
      <RoundedContainer>
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.key === tab;
            const n = counts[t.key];
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, active && styles.tabActive]}
                activeOpacity={0.8}
                onPress={() => switchTab(t.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                  {t.label}{n !== null && n !== undefined ? ` (${n})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'credit' && !loading && !error && rows.length ? (
          <View style={styles.summary}>
            <View>
              <Text style={styles.summaryLabel}>Customers</Text>
              <Text style={styles.summaryValue}>{rows.length}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.summaryLabel}>Total due</Text>
              <Text style={styles.summaryValue}>{money(creditTotal)}</Text>
            </View>
          </View>
        ) : null}

        {loading && !rows.length ? (
          <View style={styles.loadingBox}><ActivityIndicator color={ACCENT} /></View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(it) => `${tab}-${it.id}`}
            renderItem={tab === 'credit' ? renderCredit : renderReceipt}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            refreshControl={<RefreshControl refreshing={loading && !!rows.length} onRefresh={load} />}
            ListFooterComponent={loadingMore ? (
              <View style={{ paddingVertical: 12 }}><ActivityIndicator color={ACCENT} /></View>
            ) : null}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <MaterialIcons name={error ? 'cloud-off' : 'payments'} size={44} color="#cbd5e1" />
                <Text style={styles.emptyText}>{emptyText}</Text>
                {error ? (
                  <TouchableOpacity onPress={load} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
            contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
          />
        )}
      </RoundedContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 8,
  },
  tab: {
    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  tabActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  tabText: { fontSize: 12, color: '#374151', fontFamily: FONT_FAMILY.urbanistBold },
  tabTextActive: { color: '#fff' },
  summary: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: NAVY, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, marginHorizontal: 12, marginBottom: 10,
  },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: FONT_FAMILY.urbanistMedium },
  summaryValue: { fontSize: 18, color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 2 },
  loadingBox: { paddingVertical: 32, alignItems: 'center' },
  card: {
    backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 12, borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  iconDisk: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  number: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginTop: 4 },
  badgeText: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.3 },
  total: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  dueLabel: { fontSize: 11, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistSemiBold },
  detailSection: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f2f6' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  detailText: { flex: 1, color: '#4b5563', fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium },
  chip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6,
  },
  chipText: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold },
  empty: { alignItems: 'center', marginTop: 40, paddingHorizontal: 30 },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 10, fontFamily: FONT_FAMILY.urbanistMedium, lineHeight: 19 },
  retryBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: NAVY },
  retryText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold },
});

export default CustomerPaymentsListScreen;
