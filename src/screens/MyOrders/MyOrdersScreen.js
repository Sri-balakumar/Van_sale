import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ScrollView } from 'react-native';
import { NavigationHeader } from '@components/Header';
import { fetchOrdersOdoo, fetchPosOrderDetailOdoo, fetchOrdersDueSnapshotsOdoo, fetchPartnerOpenInvoicesOdoo } from '@api/services/generalApi';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { OverlayLoader } from '@components/Loader';
import { RoundedContainer, SafeAreaView, SearchContainer } from '@components/containers';
import { EmptyState } from '@components/common/empty';
import useDataFetching from '@hooks/useDataFetching';
import useDebouncedSearch from '@hooks/useDebouncedSearch';
import Icon from 'react-native-vector-icons/MaterialIcons';
import useAuthStore from '@stores/auth/useAuthStore';
import { useProductStore } from '@stores/product';
import { formatCurrency } from '@utils/currency';
import Toast from 'react-native-toast-message';
import { useFeatureHidden } from '@components/FeatureGate';
import { COLORS } from '@constants/theme';
import TaxBreakdownModal from '@components/Modal/TaxBreakdownModal';
import DueBreakdownModal from '@components/Modal/DueBreakdownModal';

// Chip filters surfaced at the top of the list. Mirrors Odoo's POS Orders
// filter dropdown — two chips combine multiple states via OR (Odoo's
// ['state','in',[...]] operator).
const STATE_FILTERS = [
  { key: 'all',       states: [],         label: 'All' },
  { key: 'paid',      states: ['paid'],   label: 'Paid' },
  { key: 'draft',     states: ['draft'],  label: 'Draft' },
  { key: 'cancelled', states: ['cancel'], label: 'Cancelled' },
];

// Map a raw single-state string (passed via route params from POSRegister
// Continue Selling → Existing Order → stateFilter:'draft') to the chip whose
// `states` array contains it.
const chipForState = (raw) => {
  if (!raw) return 'all';
  const found = STATE_FILTERS.find((f) => f.states.includes(raw));
  return found?.key ?? 'all';
};

const MyOrdersScreen = ({ navigation, route }) => {
  // Optional filters passed in from the POSRegister kebab popover or from
  // POSConfigSessions tapping into a single session. When absent the screen
  // behaves exactly like before (all orders, unscoped).
  const configId = route?.params?.configId || null;
  const sessionId = route?.params?.sessionId || null;
  const configName = route?.params?.configName || null;
  // stateFilter is the chip key ('all' / 'paid' / 'draft' / 'cancelled').
  // Initialised by translating a raw route-param state string (e.g.
  // Continue Selling passes 'draft' → draft chip) into the matching key.
  const initialStateFilter = chipForState(route?.params?.stateFilter);
  const [stateFilter, setStateFilter] = useState(initialStateFilter);
  // The actual pos.order.state values the active chip filters by.
  const activeStates = (STATE_FILTERS.find((f) => f.key === stateFilter)?.states) || [];
  const headerTitle = (() => {
    if (stateFilter === 'draft' && configName) return `Draft — ${configName}`;
    if (stateFilter === 'draft') return 'Draft Orders';
    if (configName) return `Orders — ${configName}`;
    if (sessionId) return 'Orders — this session';
    return 'Orders';
  })();

  const currency = useAuthStore((state) => state.currency);
  const decimalAccuracy = useAuthStore((state) => state.decimalAccuracy);
  useEffect(() => { console.log('[CURRENCY:RENDER] MyOrdersScreen', currency); }, [currency]);
  useEffect(() => { console.log('[CURRENCY:RENDER] MyOrdersScreen decimalAccuracy=', decimalAccuracy); }, [decimalAccuracy]);
  const { data, loading, fetchData, fetchMoreData } = useDataFetching(fetchOrdersOdoo);
  const { addProduct, clearProducts } = useProductStore();
  const [tapBusy, setTapBusy] = useState(false);
  const resumeDraftHidden = useFeatureHidden('orders.resume_draft');
  // Tax-breakdown popup state. Triggered by the blue Tax chip on each
  // taxed row. We lazy-fetch the order's lines via the existing
  // fetchPosOrderDetailOdoo on open since the list payload only has totals.
  const [taxModalVisible, setTaxModalVisible] = useState(false);
  const [taxModalOrder, setTaxModalOrder] = useState(null);
  const [taxModalLoading, setTaxModalLoading] = useState(false);

  // Customer-due state for the amber Due pill on each row.
  // `dueByOrder` is keyed by order id and MERGED, never replaced: the list
  // paginates, so fetchMoreData appends rows whose snapshots must join the
  // ones already held rather than wipe them.
  const [dueByOrder, setDueByOrder] = useState({});
  const [dueModalVisible, setDueModalVisible] = useState(false);
  const [dueModalOrder, setDueModalOrder] = useState(null);
  const [dueInvoices, setDueInvoices] = useState(null);
  const [dueInvoicesLoading, setDueInvoicesLoading] = useState(false);

  const openTaxModal = useCallback(async (orderSummary) => {
    setTaxModalOrder({ ...orderSummary, lines: [] });
    setTaxModalVisible(true);
    setTaxModalLoading(true);
    try {
      const detail = await fetchPosOrderDetailOdoo(orderSummary.id);
      if (detail && !detail.error) {
        setTaxModalOrder({ ...orderSummary, ...detail });
      }
    } catch (e) {
      console.warn('[OrdersList] tax modal fetch failed', e?.message || e);
    } finally {
      setTaxModalLoading(false);
    }
  }, []);

  // Pull the frozen due snapshots for whatever rows are on screen. Kept out of
  // fetchOrdersOdoo on purpose: that call re-throws on an Odoo error, so an
  // unknown field on an install without the module would blank the whole list.
  // Here a failure just means no pills.
  useEffect(() => {
    let alive = true;
    const ids = (Array.isArray(data) ? data : []).map((o) => o?.id).filter(Boolean);
    if (!ids.length) return undefined;
    fetchOrdersDueSnapshotsOdoo({ orderIds: ids })
      .then((map) => { if (alive && map) setDueByOrder((prev) => ({ ...prev, ...map })); })
      .catch(() => { /* no pills, list is unaffected */ });
    return () => { alive = false; };
  }, [data]);

  // Same shape as openTaxModal: show the popup at once, then lazily load the
  // detail it needs. The invoice list is live; the three totals come from the
  // frozen snapshot already in `dueByOrder`.
  const openDueModal = useCallback(async (orderSummary) => {
    // A list row carries partner_id as [id, name], but DueBreakdownModal reads
    // order.partner.name — shim it so the popup can show the customer.
    const pid = Array.isArray(orderSummary.partner_id) ? orderSummary.partner_id[0] : null;
    const pname = Array.isArray(orderSummary.partner_id) ? orderSummary.partner_id[1] : '';
    setDueModalOrder({ ...orderSummary, partner: pid ? { id: pid, name: pname } : null });
    setDueInvoices(null);
    setDueModalVisible(true);
    if (!pid) return;
    setDueInvoicesLoading(true);
    try {
      // No excludeMoveId: list rows carry no account_move, and the popup’s
      // live section is “Open invoices now”, which should include this
      // order’s own invoice.
      const res = await fetchPartnerOpenInvoicesOdoo({ partnerId: pid });
      setDueInvoices(res);
    } catch (e) {
      console.warn('[OrdersList] due modal fetch failed', e?.message || e);
      setDueInvoices(null);
    } finally {
      setDueInvoicesLoading(false);
    }
  }, []);

  const { searchText, handleSearchTextChange } = useDebouncedSearch(
    (text) => fetchData({ searchText: text, configId, sessionId, states: activeStates }),
    500
  );

  const hasLoadedRef = useRef(false);
  const hasAttemptedFetchRef = useRef(false);

  // Refresh on every focus (not just when params change). Without this, a
  // refund flow that goBacks to this screen wouldn't show the new refund
  // order in the list. The orders payload is small enough that the extra
  // round-trip on every navigation isn't an issue, and matches the user's
  // expectation: "the orders page should get refreshed".
  useFocusEffect(
    useCallback(() => {
      hasAttemptedFetchRef.current = true;
      fetchData({ searchText, configId, sessionId, states: activeStates });
      hasLoadedRef.current = true;
    }, [searchText, configId, sessionId, activeStates])
  );

  const handleLoadMore = useCallback(() => {
    fetchMoreData({ searchText, configId, sessionId, states: activeStates });
  }, [searchText, configId, sessionId, activeStates, fetchMoreData]);

  const getStatusColor = (state) => {
    switch (state) {
      case 'draft':
        return '#9e9e9e';
      case 'paid':
        return '#4caf50';
      case 'done':
        return '#8bc34a';
      case 'invoiced':
        return '#2196f3';
      case 'cancel':
        return '#f44336';
      default:
        return '#9e9e9e';
    }
  };

  const getStatusLabel = (state) => {
    switch (state) {
      case 'draft':
        return 'New';
      case 'paid':
        return 'Paid';
      case 'done':
        return 'Posted';
      case 'invoiced':
        return 'Invoiced';
      case 'cancel':
        return 'Cancelled';
      default:
        return state;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // Odoo sends datetimes as naive UTC strings ("YYYY-MM-DD HH:MM:SS").
    // Hermes parses those as local, so without an explicit Z the displayed
    // date can roll over to the wrong day for users near midnight UTC.
    // Force UTC parsing so toLocaleDateString shifts to the user's zone.
    const str = String(dateString);
    const iso = str.includes('T') ? str : str.replace(' ', 'T');
    const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
    const date = new Date(withTz);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Tap handler — paid/done/invoiced orders open OrderDetail (receipt view).
  // Draft orders reload their lines back into the cart and jump into the
  // register/cart screen so the user can resume editing.
  const handleOrderTap = useCallback(async (item) => {
    if (tapBusy) return;
    setTapBusy(true);
    try {
      if (item.state !== 'draft') {
        navigation.navigate('OrderDetail', { orderId: item.id });
        return;
      }
      if (resumeDraftHidden) {
        Toast.show({ type: 'info', text1: 'Resume draft is disabled for your user', position: 'bottom' });
        return;
      }
      // Draft → reload into cart
      const detail = await fetchPosOrderDetailOdoo(item.id);
      if (!detail || detail.error) {
        Toast.show({ type: 'error', text1: 'Failed to load order', position: 'bottom' });
        return;
      }
      // A refund/return order (negative total or "… REFUND" name) → the register
      // CTA should be "Payment" (pay out the return), like Odoo — not "Place Order".
      const isRefundOrder = Number(item.amount_total) < 0 || /REFUND/i.test(item.name || detail.name || '');
      clearProducts();
      (detail.lines || []).forEach((l) => {
        const base = {
          id: l.product_id,
          remoteId: l.product_id,
          name: l.name,
          price: l.price_unit,
          price_unit: l.price_unit,
          quantity: l.qty,
          qty: l.qty,
          image_url: l.image_url || null,
          discount_percent: l.discount,
        };
        if (isRefundOrder) {
          // Lock this returned line's tax to what was originally paid (from the
          // order details) so the pay screen keeps it regardless of With Tax.
          const excl = Number(l.price_subtotal) || 0;
          const incl = Number(l.price_subtotal_incl) || 0;
          base.isReturnLine = true;
          // Rate the original was taxed at (0 = bought without tax); applied to
          // the current returned quantity so tax scales with qty.
          base.lockedTaxRate = excl ? (incl - excl) / excl : 0;
          base.lockedTaxAmount = incl - excl;
          base.lockedTaxIds = Array.isArray(l.tax_ids) ? l.tax_ids : [];
          console.log('[RETURN TAX] (list) return line', l.name, '| qty', l.qty, '| excl', excl, '| incl', incl, '| rate', excl ? (incl - excl) / excl : 0);
        }
        addProduct(base);
      });
      if (isRefundOrder) {
        const lockedTaxTotal = (detail.lines || []).reduce((s, l) => s + ((Number(l.price_subtotal_incl) || 0) - (Number(l.price_subtotal) || 0)), 0);
        console.log('[RETURN TAX] (list) loaded', (detail.lines || []).length, 'return lines | locked tax total =', Math.round(lockedTaxTotal * 1000) / 1000);
      }
      const sessionId = Array.isArray(item.session_id) ? item.session_id[0] : null;
      const registerId = Array.isArray(item.config_id) ? item.config_id[0] : null;
      const registerName = Array.isArray(item.config_id) ? item.config_id[1] : '';
      navigation.navigate('TakeoutDelivery', {
        sessionId,
        registerId,
        registerName,
        existingOrderId: item.id,
        existingOrderRef: item.pos_reference || detail.pos_reference || '',
        userName: detail.user?.name || '',
        isRefund: isRefundOrder,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Could not open order', text2: e?.message || '', position: 'bottom' });
    } finally {
      setTapBusy(false);
    }
  }, [tapBusy, navigation, addProduct, clearProducts, resumeDraftHidden]);

  const renderOrderItem = useCallback(({ item }) => {
    const partnerName = Array.isArray(item.partner_id) ? item.partner_id[1] : item.partner_id || '—';
    const userName = Array.isArray(item.user_id) ? item.user_id[1] : item.user_id || '—';
    // pos_reference is "/" until Odoo's sequence fires; fall back to `name`
    // (the per-session sequence, e.g. "Shop/0001") so we never render a
    // bare "/" chip in the orders list.
    const ref = (item.pos_reference && item.pos_reference !== '/' ? item.pos_reference : '');
    const receiptNo = ref || (item.name && item.name !== '/' ? item.name : '');

    return (
      <TouchableOpacity
        style={styles.orderCard}
        activeOpacity={0.85}
        onPress={() => handleOrderTap(item)}
      >
        <View style={styles.orderHeader}>
          <View style={styles.orderIconContainer}>
            <Icon name="receipt" size={24} color="#461c8aff" />
          </View>
          <View style={styles.orderHeaderInfo}>
            <Text style={styles.orderName}>{item.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.state) + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.state) }]}>
                  {getStatusLabel(item.state)}
                </Text>
              </View>
              {(/REFUND/i.test(item.name || '') || Number(item.amount_total) < 0) ? (
                <View style={[styles.statusBadge, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={[styles.statusText, { color: '#B91C1C' }]}>REFUND</Text>
                </View>
              ) : null}
            </View>
          </View>
          <Text style={styles.orderAmount}>{formatCurrency(item.amount_total, currency || { symbol: '', name: '', position: 'before' })}</Text>
        </View>

        <View style={styles.orderDetails}>
          <View style={styles.detailRow}>
            <Icon name="person" size={16} color="#666" />
            <Text style={styles.detailText}>{partnerName}</Text>
          </View>
          {receiptNo ? (
            <View style={styles.receiptChip}>
              <Icon name="confirmation-number" size={14} color="#461c8aff" />
              <Text style={styles.receiptChipText}>Receipt {receiptNo}</Text>
            </View>
          ) : null}
          {Number(item.amount_tax) > 0 ? (
            <TouchableOpacity
              style={styles.taxChip}
              activeOpacity={0.85}
              onPress={(e) => {
                e.stopPropagation();
                openTaxModal(item);
              }}
            >
              <Icon name="receipt-long" size={14} color="#1E88E5" />
              <Text style={styles.taxChipText}>
                {`Tax ${formatCurrency(item.amount_tax, currency || { symbol: '', name: '', position: 'before' })}`}
              </Text>
              <Icon name="chevron-right" size={14} color="#1E88E5" />
            </TouchableOpacity>
          ) : null}
          {/* Due — the customer’s frozen balance for this order. Sibling of
              the Tax pill above: same shape, amber instead of blue. `captured`
              is the half that matters in the guard — it separates an order with
              no snapshot (placed before the feature, or outside the app) from a
              customer who genuinely owes nothing. */}
          {(() => {
            const snap = dueByOrder[item.id];
            if (!snap?.captured || Number(snap.totalDue) <= 0) return null;
            return (
              <TouchableOpacity
                style={styles.dueChip}
                activeOpacity={0.85}
                onPress={(e) => {
                  // Without this the row’s own onPress also fires and
                  // navigates into the order instead of opening the popup.
                  e?.stopPropagation?.();
                  openDueModal(item);
                }}
              >
                <Icon name="account-balance-wallet" size={14} color="#9A3412" />
                <Text style={styles.dueChipText}>
                  {`Due ${formatCurrency(snap.totalDue, currency || { symbol: '', name: '', position: 'before' })}`}
                </Text>
                <Icon name="chevron-right" size={14} color="#9A3412" />
              </TouchableOpacity>
            );
          })()}
          <View style={styles.detailRow}>
            <Icon name="person-outline" size={16} color="#666" />
            <Text style={styles.detailText}>Salesperson: {userName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Icon name="event" size={16} color="#666" />
            <Text style={styles.detailText}>{formatDate(item.date_order)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [currency, handleOrderTap, openTaxModal, openDueModal, dueByOrder]);

  const keyExtractor = useCallback((item, index) => `order-${item.id || index}`, []);

  const renderEmptyState = useCallback(() => (
    <EmptyState
      imageSource={require('@assets/images/EmptyData/empty_data.png')}
      message="No orders found"
    />
  ), []);

  const renderOrders = () => {
    if (loading && data.length === 0 && hasAttemptedFetchRef.current) {
      return null;
    }
    if (data.length === 0 && !loading && hasAttemptedFetchRef.current) {
      return renderEmptyState();
    }
    if (data.length > 0) {
      return (
        <FlashList
          data={data}
          renderItem={renderOrderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: 10, paddingBottom: 50 }}
          onEndReached={handleLoadMore}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.5}
          estimatedItemSize={150}
          removeClippedSubviews={true}
          refreshing={loading}
          onRefresh={() => fetchData({ searchText, configId, sessionId, states: activeStates })}
        />
      );
    }
    return null;
  };

  return (
    <SafeAreaView>
      <NavigationHeader
        title={headerTitle}
        onBackPress={() => navigation.goBack()}
      />
      <SearchContainer
        placeholder="Search Orders"
        onChangeText={handleSearchTextChange}
        value={searchText}
      />

      {/* State filter chips — single-line horizontal strip just under the
          search bar. Tapping a chip flips `stateFilter` and the existing
          useFocusEffect re-fetches the list scoped to that state. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterStripContent}
        style={styles.filterStrip}
      >
        {STATE_FILTERS.map((f) => {
          const active = stateFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              activeOpacity={0.85}
              onPress={() => setStateFilter(f.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <RoundedContainer>
        {renderOrders()}
      </RoundedContainer>

      <OverlayLoader visible={loading || tapBusy} />

      <TaxBreakdownModal
        isVisible={taxModalVisible}
        order={taxModalOrder}
        loading={taxModalLoading}
        currency={currency}
        onClose={() => setTaxModalVisible(false)}
      />

      <DueBreakdownModal
        isVisible={dueModalVisible}
        order={dueModalOrder}
        snapshot={dueByOrder[dueModalOrder?.id]}
        openInvoices={dueInvoices}
        loading={dueInvoicesLoading}
        currency={currency}
        onClose={() => setDueModalVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f5f0ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  orderHeaderInfo: {
    flex: 1,
  },
  orderName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2d2d2d',
    marginBottom: 6,
  },
  orderAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#461c8aff',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  orderDetails: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
    color: '#666',
    flex: 1,
  },
  receiptChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3EEFB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  receiptChipText: {
    fontSize: 12,
    color: '#461c8aff',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  taxChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E7F1FD',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  taxChipText: {
    fontSize: 12,
    color: '#1E88E5',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Mirrors taxChip, in the amber this feature uses everywhere else (the
  // Customer Due card, the POS payment screen’s Previous Due card and the
  // breakdown popup), so all four read as one thing.
  dueChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  dueChipText: {
    fontSize: 12,
    color: '#9A3412',
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Filter chip strip (All / Paid / Unpaid / Done / …) ────────────────
  filterStrip: { flexGrow: 0, backgroundColor: '#fff' },
  filterStripContent: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: COLORS.primaryThemeColor,
    backgroundColor: '#fff',
  },
  filterChipActive: {
    backgroundColor: COLORS.primaryThemeColor,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primaryThemeColor,
    letterSpacing: 0.3,
  },
  filterChipTextActive: { color: '#fff' },
});

export default MyOrdersScreen;
