import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  StatusBar,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from '@components/containers';
import { SafeAreaView as SafeAreaViewNative } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { fetchPosOrderDetailOdoo, fetchPosOrderPaymentsOdoo, fetchPosOrderSignaturesOdoo, refundPosOrder, countRefundsForOrder, markOrderAsRefunded, isOrderMarkedRefunded, resolveInvoiceHtml, fetchAppPaperSize, isPosSessionOpenForOrder, fetchPartnerOutstandingOdoo, fetchOrderDueSnapshotOdoo } from '@api/services/generalApi';
import { formatCurrency } from '@utils/currency';
import { generateInvoiceHtml, extractOrderRef, printPageSize } from '@utils/invoiceHtml';
import useAuthStore from '@stores/auth/useAuthStore';
import { useProductStore } from '@stores/product';
import Toast from 'react-native-toast-message';
import { FeatureGate } from '@components/FeatureGate';
import LocationModal from '@components/Modal/LocationModal';
import PaperSizeModal from '@components/Modal/PaperSizeModal';
import TaxBreakdownModal from '@components/Modal/TaxBreakdownModal';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';
const SOFT_GREEN_BG = '#DCFCE7';
const SOFT_GREEN_FG = '#166534';
const MUTED = '#8896ab';
// Amber "money owed" palette — the same one `splitBadge` below and the POS
// payment screen's Previous Due card already use, so the Customer Due card
// reads as the same feature across both screens.
const DUE_BG = '#FFF7ED';
const DUE_BORDER = '#FED7AA';
const DUE_FG = '#9A3412';

const stateBadge = (state) => {
  switch (state) {
    case 'draft': return { bg: '#F3F4F6', fg: '#6B7280', label: 'New' };
    case 'paid': return { bg: SOFT_GREEN_BG, fg: SOFT_GREEN_FG, label: 'Paid' };
    case 'done': return { bg: '#DBEAFE', fg: '#1E40AF', label: 'Posted' };
    case 'invoiced': return { bg: '#DBEAFE', fg: '#1E40AF', label: 'Invoiced' };
    case 'cancel': return { bg: '#FEE2E2', fg: '#B91C1C', label: 'Cancelled' };
    default: return { bg: '#F3F4F6', fg: '#6B7280', label: state || '—' };
  }
};

// Odoo returns datetimes as naive UTC strings ("2026-05-07 04:57:00") with
// no timezone marker. Hermes and most JS engines parse that format as
// LOCAL time, so the displayed clock would shift by the user's UTC offset
// (e.g. IST users would see 04:57 instead of the 10:27 that Odoo's web UI
// shows). Force-interpret the string as UTC so toLocaleString converts it
// back to the user's local zone correctly.
const parseOdooDate = (s) => {
  if (!s) return null;
  const str = String(s);
  const iso = str.includes('T') ? str : str.replace(' ', 'T');
  const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const d = new Date(withTz);
  return isNaN(d.getTime()) ? null : d;
};

const formatDate = (s) => {
  if (!s) return '—';
  const d = parseOdooDate(s);
  if (!d) return s;
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const OrderDetailScreen = ({ navigation, route }) => {
  const { orderId } = route?.params || {};
  const currency = useAuthStore((state) => state.currency) || { symbol: '', name: '', position: 'before' };
  const decimalAccuracy = useAuthStore((state) => state.decimalAccuracy);
  const companyProfile = useAuthStore((state) => state.companyProfile);
  const authUser = useAuthStore((state) => state.user);
  useEffect(() => { console.log('[CURRENCY:RENDER] OrderDetailScreen', currency); }, [currency]);
  useEffect(() => { console.log('[CURRENCY:RENDER] OrderDetailScreen decimalAccuracy=', decimalAccuracy); }, [decimalAccuracy]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [taxModalVisible, setTaxModalVisible] = useState(false);
  // Each `pos.payment` attached to this order — drives the Payments card so
  // split-paid orders surface every method + amount instead of just the
  // aggregate `amount_paid`.
  const [payments, setPayments] = useState([]);
  // Captured signatures (base64 PNG) for this order's receipt re-export.
  const [signatures, setSignatures] = useState({ owner: null, customer: null });

  // Invoice-action state — Preview / Download / Print mirror the buttons on
  // the post-payment receipt screen, so the cashier can re-export any past
  // order's invoice from the orders list.
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Holds the pending action ('preview' | 'download' | 'print') while the
  // PaperSizeModal is open. Cleared when the user picks a size or cancels.
  const [sizePicker, setSizePicker] = useState(null);
  // Default receipt-size config from Invoice Settings (pos.invoice.settings via
  // RPC). When enabled, the action chips skip the picker and use `mm` directly.
  const [paperCfg, setPaperCfg] = useState({ enabled: false, mm: null, heightMm: 0 });
  useEffect(() => {
    let alive = true;
    fetchAppPaperSize().then((cfg) => {
      if (!alive) return;
      console.log('[PAPER SIZE] OrderDetail loaded config =', cfg);
      setPaperCfg(cfg);
    });
    return () => { alive = false; };
  }, []);

  // Customer's outstanding balance for the receipt's Customer Due block. The
  // order's own invoice is excluded so "Previous Due" and "This Invoice" can't
  // double-count it. Only used on the app-rendered receipt — when
  // pos_dynamic_invoice is enabled the server computes the same three figures.
  const [due, setDue] = useState(null);
  useEffect(() => {
    let alive = true;
    const partnerId = order?.partner?.id || null;
    if (!partnerId) { setDue(null); return undefined; }
    const am = order?.account_move;
    const excludeMoveId = Array.isArray(am) ? am[0] : (am || null);
    fetchPartnerOutstandingOdoo({
      partnerId,
      excludeMoveId,
      thisInvoiceDue: Math.max(0, Number(order.amount_total || 0) - Number(order.amount_paid || 0)),
    })
      .then((res) => { if (alive) setDue(res); })
      .catch(() => { if (alive) setDue(null); });
    return () => { alive = false; };
  }, [order?.partner?.id, order?.account_move, order?.amount_total, order?.amount_paid]);

  // Frozen Customer Due snapshot, stored on the order when it was sold. This
  // is NOT `due` above: that one is live (what the customer owes right now) and
  // feeds the printed receipt; this one is history (what they owed on the day
  // of this sale) and never changes once captured. The two legitimately differ
  // once the customer settles up.
  const [dueSnapshot, setDueSnapshot] = useState(null);
  useEffect(() => {
    let alive = true;
    const id = order?.id || null;
    if (!id) { setDueSnapshot(null); return undefined; }
    fetchOrderDueSnapshotOdoo({ orderId: id })
      .then((res) => { if (alive) setDueSnapshot(res); })
      .catch(() => { if (alive) setDueSnapshot(null); });
    return () => { alive = false; };
  }, [order?.id]);

  // Return-Products button state — true while the pos.order.refund RPC is in
  // flight so the button can show a spinner and prevent double-taps. The
  // confirm dialog is a styled Modal (not native Alert) to match the rest of
  // the app's popups (LogoutModal / Close Register).
  const [refunding, setRefunding] = useState(false);
  const [returnConfirmVisible, setReturnConfirmVisible] = useState(false);
  // "Invalid Operation" popup (like Odoo) shown when the POS session is closed
  // and a return is attempted.
  const [invalidOpMsg, setInvalidOpMsg] = useState('');
  const { addProduct, clearProducts } = useProductStore();
  // Force-hide flag for the Return Products button on already-refunded
  // orders. Three signals feed into it:
  //  1. Local AsyncStorage marker — instant truth if we created the refund
  //     from this app (independent of Odoo round-trip reliability).
  //  2. pos.order.refunded_order_id count (Odoo 17+ link).
  //  3. pos.order.line.refunded_orderline_id count (older Odoo line-level link).
  // Any one of these turning truthy hides the button.
  const [refundDetected, setRefundDetected] = useState(false);

  // Multi-source refund detection: local AsyncStorage marker first (instant,
  // works even if Odoo can't read the link back), then server-side counts
  // at both order- and line-level. Any positive signal flips refundDetected
  // → true and hides the Return Products button.
  useEffect(() => {
    if (!order?.id) { setRefundDetected(false); return; }
    let alive = true;
    (async () => {
      try {
        const localMarked = await isOrderMarkedRefunded(order.id);
        if (!alive) return;
        if (localMarked) { setRefundDetected(true); return; }
        const orderLineIds = Array.isArray(order.lines)
          ? order.lines.map((l) => l?.id).filter(Boolean)
          : [];
        const n = await countRefundsForOrder({ orderId: order.id, lineIds: orderLineIds });
        if (alive && Number(n) > 0) setRefundDetected(true);
      } catch (_) {
        // Soft-fail: leave refundDetected as-is rather than flipping back to
        // false on a transient network error.
      }
    })();
    return () => { alive = false; };
  }, [order?.id, order?.lines]);

  // True when this order is itself a refund of another order — drives the
  // small red REFUND chip + "Refunded from {original}" link near the header.
  const isRefund = !!(order?.refunded_order_id && (Array.isArray(order.refunded_order_id) ? order.refunded_order_id[0] : order.refunded_order_id));
  const refundedOriginalId = isRefund ? (Array.isArray(order.refunded_order_id) ? order.refunded_order_id[0] : order.refunded_order_id) : null;
  const refundedOriginalName = isRefund && Array.isArray(order.refunded_order_id) ? order.refunded_order_id[1] : '';

  // Whether Return Products is allowed on this order. Disabled when:
  // - the order is itself a refund (no re-refunding a refund),
  // - the order has already been fully refunded once (`refund_orders_count > 0`),
  // - or the order isn't in a "paid"/"done"/"invoiced" state.
  const canRefund = order
    && !isRefund
    && !refundDetected
    && (Number(order.refund_orders_count) || 0) === 0
    && ['paid', 'done', 'invoiced'].includes(order.state);

  // Refund orders are created as unpaid drafts. "Payment" loads the refund
  // lines into the cart and opens the pay flow (same path as resuming a draft
  // order from the Orders list), so the cashier can pay out the return.
  const isUnpaidRefund = isRefund && order?.state === 'draft';

  // Load an order's lines into the cart and open the register/pay screen
  // (same path as resuming a draft from the Orders list). Used both by the
  // refund-order Payment button and right after a return is created.
  const openPayFlowForOrder = (ord) => {
    if (!ord) return;
    clearProducts();
    (ord.lines || []).forEach((l) => {
      // For a return, lock this line's tax to what was ORIGINALLY paid, read
      // straight from the order details: (tax-incl − tax-excl) per line. This
      // survives into POSPayment so the return line's tax is fixed and the
      // With Tax toggle can't change it. (Values are negative for a refund.)
      const excl = Number(l.price_subtotal) || 0;
      const incl = Number(l.price_subtotal_incl) || 0;
      addProduct({
        id: l.product_id,
        remoteId: l.product_id,
        name: l.name,
        price: l.price_unit,
        price_unit: l.price_unit,
        quantity: l.qty,
        qty: l.qty,
        image_url: l.image_url || null,
        discount_percent: l.discount,
        isReturnLine: true,
        // Rate the original was taxed at (0 = bought without tax). Applied to
        // the CURRENT returned quantity, so tax scales if the qty is changed.
        lockedTaxRate: excl ? (incl - excl) / excl : 0,
        lockedTaxAmount: incl - excl,
        // The ORIGINAL tax ids so Odoo books exactly the tax paid (not the
        // product's current default, which may have changed since the sale).
        lockedTaxIds: Array.isArray(l.tax_ids) ? l.tax_ids : [],
      });
      console.log('[RETURN TAX] return line', l.name, '| qty', l.qty, '| excl', excl, '| incl', incl, '| rate', excl ? (incl - excl) / excl : 0);
    });
    const lockedTaxTotal = (ord.lines || []).reduce((s, l) => s + ((Number(l.price_subtotal_incl) || 0) - (Number(l.price_subtotal) || 0)), 0);
    console.log('[RETURN TAX] loaded', (ord.lines || []).length, 'return lines | locked tax total =', Math.round(lockedTaxTotal * 1000) / 1000);
    // fetchPosOrderDetailOdoo returns session/config as {id,name} objects; the
    // list fetch returns session_id/config_id as [id,name] arrays. Support both.
    const sessionId = ord.session?.id ?? (Array.isArray(ord.session_id) ? ord.session_id[0] : null);
    const registerId = ord.config?.id ?? (Array.isArray(ord.config_id) ? ord.config_id[0] : null);
    const registerName = ord.config?.name ?? (Array.isArray(ord.config_id) ? ord.config_id[1] : '');
    console.log('[Refund] → register/pay flow | existingOrderId', ord.id, '| lines', (ord.lines || []).length, '| sessionId', sessionId, '| registerId', registerId);
    navigation.navigate('TakeoutDelivery', {
      sessionId,
      registerId,
      registerName,
      existingOrderId: ord.id,
      existingOrderRef: ord.pos_reference || '',
      userName: ord.user?.name || '',
      isRefund: true,   // so the register shows Payment (not Place Order)
    });
  };

  const handlePayRefund = () => {
    console.log('[Refund] pay refund tapped — order', order?.id, '| state', order?.state);
    openPayFlowForOrder(order);
  };

  const handleReturnProducts = async () => {
    if (!order || !canRefund || refunding) return;
    // Odoo requires an OPEN session on the order's POS to return products.
    // Resolve the config server-side (the cached order may lack config_id) and
    // show the same "Invalid Operation" popup when it's closed.
    setRefunding(true);
    const { open, configName } = await isPosSessionOpenForOrder({ orderId: order.id });
    setRefunding(false);
    console.log('[Refund] return tapped — order', order.id, '| config', configName, '| sessionOpen', open);
    if (!open) {
      console.log('[Refund] session closed → showing Invalid Operation popup');
      setInvalidOpMsg(`To return product(s), you need to open a session in the POS ${configName}`);
      return;
    }
    setReturnConfirmVisible(true);
  };

  // Confirm step from the styled popup. Runs the refund RPC and bounces back
  // to the Orders list (which refreshes on focus) rather than navigating to
  // the new refund order, per the user's UX request.
  const confirmReturnProducts = async () => {
    setReturnConfirmVisible(false);
    if (!order) return;
    setRefunding(true);
    try {
      const resp = await refundPosOrder({ orderId: order.id });
      if (resp?.error) {
        const msg = resp.error.message || '';
        // Session-closed error → show Odoo's "Invalid Operation" popup, not a toast.
        if (/open a session|need to open|session/i.test(msg)) {
          setInvalidOpMsg(msg);
        } else {
          Toast.show({ type: 'error', text1: 'Refund failed', text2: msg || 'Try again later', position: 'bottom' });
        }
        return;
      }
      // Persist that this order has been refunded so the next visit instantly
      // hides Return Products, even if Odoo's read-back is unreliable.
      try { await markOrderAsRefunded(order.id); } catch (_) {}
      setRefundDetected(true);
      Toast.show({
        type: 'success',
        text1: 'Products returned',
        text2: 'Refund order created — ready for payment.',
        position: 'bottom',
      });
      // The refund order now exists in the Orders list (a real pos.order). Take
      // the cashier straight into the register/pay screen loaded with it (like
      // Odoo), so they can pay out the return immediately.
      console.log('[Refund] refund created for order', order.id, '→ newOrderId', resp.newOrderId);
      if (resp.newOrderId) {
        const newDetail = await fetchPosOrderDetailOdoo(resp.newOrderId);
        if (newDetail && !newDetail.error) {
          openPayFlowForOrder(newDetail);
        } else {
          console.log('[Refund] could not load refund order → going back to list');
          navigation.goBack();
        }
      } else {
        console.log('[Refund] no newOrderId returned → going back to list');
        navigation.goBack();
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Refund failed', text2: e?.message || 'Try again later', position: 'bottom' });
    } finally {
      setRefunding(false);
    }
  };

  // Map the fetched pos.order + pos.payment[] into the params expected by the
  // shared `generateInvoiceHtml` helper. Kept inline because it depends on
  // the screen's `order` and `payments` state.
  const buildInvoiceParams = () => {
    if (!order) return null;
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const items = lines.map((l) => ({
      id: l.id,
      name: l.full_product_name || l.product_name || l.name || 'Product',
      qty: Number(l.qty || l.quantity || 1),
      price: Number(l.price_unit || l.price || 0),
      discount_percent: Number(l.discount || 0),
      subtotal: Number(l.price_subtotal_incl ?? l.price_subtotal ?? 0),
    }));
    // fetchPosOrderDetailOdoo reshapes the order: the partner comes back as
    // `order.partner = { id, name }` (NOT the raw `partner_id` tuple), so read
    // that — otherwise the customer resolves to null and the receipt's
    // Customer Details block is skipped on re-export.
    const customer = order.partner ? { name: order.partner.name } : null;
    // Raw subtotal = sum of (price_unit × qty) across every line,
    // BEFORE any per-line discount %. amount_total is the discounted
    // figure that Odoo persisted, so the difference is the rolled-up
    // total discount the cashier applied (whether it came from this
    // app's total-discount UI as a flat % on every line or from any
    // mix of per-line discounts entered elsewhere).
    const rawSubtotal = lines.reduce(
      (s, l) => s + (Number(l.price_unit || l.price || 0) * Number(l.qty || l.quantity || 1)),
      0,
    );
    const amountTotal = Number(order.amount_total || 0);
    const amountTax = Number(order.amount_tax || 0);
    const rolledDiscount = Math.max(
      0,
      Math.round((rawSubtotal - (amountTotal - amountTax)) * 1000) / 1000,
    );
    return {
      items,
      subtotal: rawSubtotal,
      tax: amountTax,
      service: 0,
      total: amountTotal,
      discount: rolledDiscount,
      orderId: order.id,
      orderName: order.name || '',
      paidAmount: Number(order.amount_paid || 0),
      customer,
      payments,
      shopOwnerSignature: signatures.owner,
      customerSignature: signatures.customer,
      previousDue: due?.previousDue || 0,
      thisInvoiceDue: due?.thisInvoiceDue || 0,
      totalDue: due?.totalDue || 0,
    };
  };

  const runPreview = async (paperWidthMm, paperHeightMm = 0) => {
    try {
      const params = buildInvoiceParams();
      if (!params) return;
      const html = await resolveInvoiceHtml({ ...params, paperWidthMm, paperHeightMm, companyProfile, cashierName: order?.user?.name || authUser?.name || authUser?.username || authUser?.login || 'Cashier' });
      setPreviewHtml(html);
      setPreviewVisible(true);
    } catch (err) {
      console.error('[OrderDetail] preview error', err);
      Toast.show({ type: 'error', text1: 'Preview failed', text2: err?.message || 'Unable to render preview', position: 'bottom' });
    }
  };

  const runDownload = async (paperWidthMm, paperHeightMm = 0) => {
    setDownloading(true);
    try {
      const params = buildInvoiceParams();
      if (!params) throw new Error('Order not loaded');
      const filename = `Invoice-${extractOrderRef(order?.name, order?.id)}.pdf`;
      console.log(`[Download] start — order=${order?.id} size=${paperWidthMm}mm`);
      const html = await resolveInvoiceHtml({ ...params, paperWidthMm, paperHeightMm, companyProfile, cashierName: order?.user?.name || authUser?.name || authUser?.username || authUser?.login || 'Cashier' });
      console.log(`[Download] receipt HTML ready — ${html?.length || 0} chars`);
      // Exact page size (points) so the PDF page == the physical roll → printer
      // prints at 100%, no downscaling that smears thermal text.
      const { uri } = await Print.printToFileAsync({ html, ...printPageSize(paperWidthMm, paperHeightMm) });
      console.log(`[Download] PDF generated — ${uri || '(no uri)'}`);
      if (!uri) throw new Error('Failed to generate PDF');

      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) {
          Toast.show({ type: 'info', text1: 'Save cancelled', position: 'bottom' });
          return;
        }
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          filename,
          'application/pdf'
        );
        await FileSystem.writeAsStringAsync(targetUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        Toast.show({ type: 'success', text1: 'Saved', text2: filename, position: 'bottom' });
      } else {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            UTI: 'com.adobe.pdf',
            dialogTitle: filename,
          });
        } else {
          Toast.show({ type: 'error', text1: 'Save failed', text2: 'Sharing is not available on this device', position: 'bottom' });
        }
      }
    } catch (err) {
      console.error('[OrderDetail] download error', err);
      Toast.show({ type: 'error', text1: 'Download failed', text2: err?.message || 'Unable to generate PDF', position: 'bottom' });
    } finally {
      setDownloading(false);
    }
  };

  const runPrint = async (paperWidthMm, paperHeightMm = 0) => {
    setPrinting(true);
    try {
      const params = buildInvoiceParams();
      if (!params) throw new Error('Order not loaded');
      const html = await resolveInvoiceHtml({ ...params, paperWidthMm, paperHeightMm, companyProfile, cashierName: order?.user?.name || authUser?.name || authUser?.username || authUser?.login || 'Cashier' });
      // Exact page size (points) so the printer prints at 100% with no scaling.
      await Print.printAsync({ html, ...printPageSize(paperWidthMm, paperHeightMm) });
    } catch (err) {
      if (err?.message && !/cancel/i.test(err.message)) {
        console.error('[OrderDetail] print error', err);
        Toast.show({ type: 'error', text1: 'Print failed', text2: err?.message, position: 'bottom' });
      }
    } finally {
      setPrinting(false);
    }
  };

  // Entry point for the three action chips. When a default size is configured
  // we run the action immediately; otherwise we open the size picker.
  const startAction = (action) => {
    if (paperCfg.enabled && paperCfg.mm) {
      console.log(`[PAPER SIZE] ${action}: using default ${paperCfg.mm}mm × ${paperCfg.heightMm || 'auto'} (skipping picker)`);
      if (action === 'preview') runPreview(paperCfg.mm, paperCfg.heightMm);
      else if (action === 'download') runDownload(paperCfg.mm, paperCfg.heightMm);
      else if (action === 'print') runPrint(paperCfg.mm, paperCfg.heightMm);
    } else {
      console.log(`[PAPER SIZE] ${action}: no default set — opening size picker`);
      setSizePicker(action);
    }
  };

  useEffect(() => {
    let alive = true;
    if (!orderId) {
      setLoading(false);
      return;
    }
    Promise.all([
      fetchPosOrderDetailOdoo(orderId),
      fetchPosOrderPaymentsOdoo(orderId),
      fetchPosOrderSignaturesOdoo(orderId),
    ])
      .then(([orderRes, paymentRows, sigRes]) => {
        if (!alive) return;
        if (orderRes?.error) {
          Toast.show({ type: 'error', text1: 'Failed to load order', position: 'bottom' });
          return;
        }
        setOrder(orderRes);
        setPayments(Array.isArray(paymentRows) ? paymentRows : []);
        if (sigRes) {
          setSignatures({
            owner: sigRes.shop_owner_signature || null,
            customer: sigRes.customer_signature || null,
          });
        }
      })
      .catch(() => {
        Toast.show({ type: 'error', text1: 'Failed to load order', position: 'bottom' });
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [orderId]);

  if (loading) {
    return (
      <SafeAreaView backgroundColor={NAVY}>
        <StatusBar barStyle="light-content" backgroundColor={NAVY} />
        <View style={s.center}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView backgroundColor={NAVY}>
        <StatusBar barStyle="light-content" backgroundColor={NAVY} />
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={s.topTitle}>Order</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.center}>
          <Text style={{ color: MUTED }}>Order not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const badge = stateBadge(order.state);

  return (
    <SafeAreaView backgroundColor={NAVY}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      <View style={s.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>Order {order.name}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: '#F5F6FA' }}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card */}
        <View style={s.heroCard}>
          <View style={s.heroTop}>
            <View style={[s.successDisk, { backgroundColor: badge.bg }]}>
              <MaterialIcons name="check-circle" size={26} color={badge.fg} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={s.orderName}>{order.name || '—'}</Text>
                {isRefund ? (
                  <View style={s.refundChip}>
                    <Text style={s.refundChipText}>REFUND</Text>
                  </View>
                ) : null}
              </View>
              {order.pos_reference ? (
                <Text style={s.receiptText}>Receipt {order.pos_reference}</Text>
              ) : null}
              {isRefund && refundedOriginalId ? (
                <TouchableOpacity
                  onPress={() => navigation.replace('OrderDetailScreen', { orderId: refundedOriginalId })}
                  activeOpacity={0.7}
                  style={{ marginTop: 4 }}
                >
                  <Text style={s.refundedFromLink}>{`Refunded from ${refundedOriginalName || '#' + refundedOriginalId}`}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={[s.statusPill, { backgroundColor: badge.bg }]}>
              <Text style={[s.statusText, { color: badge.fg }]}>{badge.label}</Text>
            </View>
          </View>

          <View style={s.metaRow}>
            <View style={s.metaCell}>
              <Text style={s.metaLabel}>DATE</Text>
              <Text style={s.metaValue}>{formatDate(order.date_order)}</Text>
            </View>
            <View style={s.metaCell}>
              <Text style={s.metaLabel}>CUSTOMER</Text>
              <Text style={s.metaValue} numberOfLines={1}>{order.partner?.name || '—'}</Text>
            </View>
          </View>
          <View style={s.metaRow}>
            <View style={s.metaCell}>
              <Text style={s.metaLabel}>SALESPERSON</Text>
              <Text style={s.metaValue} numberOfLines={1}>{order.user?.name || '—'}</Text>
            </View>
            <View style={s.metaCell}>
              <Text style={s.metaLabel}>REGISTER</Text>
              <Text style={s.metaValue} numberOfLines={1}>{order.config?.name || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Lines */}
        <Text style={s.sectionTitle}>ITEMS</Text>
        <View style={s.linesCard}>
          {order.lines.length === 0 ? (
            <Text style={[s.metaValue, { color: MUTED, textAlign: 'center', paddingVertical: 14 }]}>
              No items on this order
            </Text>
          ) : (
            order.lines.map((line, idx) => (
              <View
                key={String(line.id)}
                style={[s.lineRow, idx === order.lines.length - 1 && { borderBottomWidth: 0 }]}
              >
                <View style={s.lineThumbWrap}>
                  {line.image_url ? (
                    <Image
                      source={{ uri: line.image_url }}
                      style={s.lineThumb}
                    />
                  ) : (
                    <View style={[s.lineThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef0f5' }]}>
                      <MaterialIcons name="inventory-2" size={20} color={MUTED} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.lineName} numberOfLines={2}>{line.name}</Text>
                  {/* Two separate <Text> spans avoid the RTL/LTR reorder
                      that made "1 × 1.80 ر.ع." render as "1.80 ر.ع. = 1"
                      when the Arabic currency symbol sat next to the × */}
                  <View style={s.lineMetaRow}>
                    <Text style={s.lineMetaQty}>{`Qty × ${line.qty}`}</Text>
                    <Text style={s.lineMetaPrice}>
                      {formatCurrency(line.price_unit, currency)}
                    </Text>
                    {line.discount > 0 ? (
                      <Text style={s.lineMetaDiscount}>{`−${line.discount}%`}</Text>
                    ) : null}
                  </View>
                </View>
                <Text style={s.lineSubtotal}>{formatCurrency(line.price_subtotal_incl || line.price_subtotal, currency)}</Text>
              </View>
            ))
          )}
        </View>

        {/* Totals */}
        <View style={s.totalsCard}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Paid</Text>
            <Text style={s.totalValue}>{formatCurrency(order.amount_paid, currency)}</Text>
          </View>
          {order.amount_return > 0 ? (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Change</Text>
              <Text style={s.totalValue}>{formatCurrency(order.amount_return, currency)}</Text>
            </View>
          ) : null}
          {Number(order.amount_tax) > 0 ? (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Tax</Text>
              <Text style={s.totalValue}>{formatCurrency(order.amount_tax, currency)}</Text>
            </View>
          ) : null}
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.grandLabel}>Total</Text>
            <Text style={s.grandValue}>{formatCurrency(order.amount_total, currency)}</Text>
          </View>
        </View>

        {/* Customer Due — the frozen snapshot taken when this order was sold,
            so it reads as history rather than a live balance. Hidden when the
            order predates the feature (`captured` false, which is why a plain
            zero check is not enough), when the module isn't installed, and
            when the customer owed nothing — a settled sale looks as before. */}
        {dueSnapshot?.captured && Number(dueSnapshot.totalDue) > 0 ? (
          <View style={[s.totalsCard, s.dueCard]}>
            <View style={s.dueHeaderRow}>
              <MaterialIcons name="account-balance-wallet" size={16} color={DUE_FG} />
              <Text style={s.dueTitle}>CUSTOMER DUE</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.dueLabel}>Previous Due</Text>
              <Text style={s.dueValue}>{formatCurrency(dueSnapshot.previousDue, currency)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.dueLabel}>This Invoice</Text>
              <Text style={s.dueValue}>{formatCurrency(dueSnapshot.thisInvoiceDue, currency)}</Text>
            </View>
            <View style={s.dueDivider} />
            <View style={s.totalRow}>
              <Text style={s.dueGrandLabel}>Total Due</Text>
              <Text style={s.dueGrandValue}>{formatCurrency(dueSnapshot.totalDue, currency)}</Text>
            </View>
          </View>
        ) : null}

        {/* Payments — one row per pos.payment record. For split-paid orders
            (more than one payment) this is the only place the breakdown is
            visible; the totals card alone just shows `amount_paid` and hides
            which methods made it up. */}
        {payments && payments.length > 0 ? (
          <View style={s.totalsCard}>
            <View style={s.paymentsHeaderRow}>
              <Text style={s.sectionTitle}>
                {payments.length > 1 ? 'PAYMENTS (SPLIT)' : 'PAYMENT'}
              </Text>
              {payments.length > 1 ? (
                <View style={s.splitBadge}>
                  <MaterialIcons name="call-split" size={12} color="#9A3412" />
                  <Text style={s.splitBadgeText}>{`${payments.length} methods`}</Text>
                </View>
              ) : null}
            </View>
            {payments.map((p, idx) => (
              <View key={p.id || idx} style={s.totalRow}>
                <Text style={s.totalLabel} numberOfLines={1}>
                  {p.method_name || 'Payment'}
                </Text>
                <Text style={s.totalValue}>{formatCurrency(p.amount, currency)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Invoice actions — Preview / Download / Print. Mirror of the chips
            on the post-payment receipt screen so any past order can be
            re-exported from the orders list. */}
        <View style={s.invoiceActionRow}>
          <TouchableOpacity
            onPress={() => startAction('preview')}
            activeOpacity={0.85}
            style={[s.invoiceChip, { borderColor: '#BFDBFE' }]}
          >
            <View style={s.invoiceChipIcon}>
              <MaterialIcons name="preview" size={20} color="#1E88E5" />
            </View>
            <Text style={s.invoiceChipText}>Preview</Text>
          </TouchableOpacity>

          <FeatureGate featureKey="orders.export_pdf">
            <TouchableOpacity
              onPress={() => startAction('download')}
              disabled={downloading}
              activeOpacity={0.85}
              style={[s.invoiceChip, { borderColor: '#FED7AA' }, downloading && { opacity: 0.6 }]}
            >
              <View style={s.invoiceChipIcon}>
                {downloading ? (
                  <ActivityIndicator color="#E85D04" size="small" />
                ) : (
                  <MaterialIcons name="file-download" size={20} color="#E85D04" />
                )}
              </View>
              <Text style={s.invoiceChipText}>Download</Text>
            </TouchableOpacity>
          </FeatureGate>

          <TouchableOpacity
            onPress={() => startAction('print')}
            disabled={printing}
            activeOpacity={0.85}
            style={[s.invoiceChip, { borderColor: '#E9D5FF' }, printing && { opacity: 0.6 }]}
          >
            <View style={s.invoiceChipIcon}>
              {printing ? (
                <ActivityIndicator color="#7B2D8E" size="small" />
              ) : (
                <MaterialCommunityIcons name="printer" size={20} color="#7B2D8E" />
              )}
            </View>
            <Text style={s.invoiceChipText}>Print</Text>
          </TouchableOpacity>

          {/* Tax Breakdown — per-line tax detail popup. Only rendered when
              the order actually carries tax; for non-taxed orders this
              chip stays hidden to avoid empty UI. */}
          {Number(order?.amount_tax) > 0 ? (
            <TouchableOpacity
              onPress={() => setTaxModalVisible(true)}
              activeOpacity={0.85}
              style={[s.invoiceChip, { borderColor: '#BFDBFE' }]}
            >
              <View style={s.invoiceChipIcon}>
                <MaterialIcons name="receipt-long" size={20} color="#1E88E5" />
              </View>
              <Text style={s.invoiceChipText}>Tax Breakdown</Text>
            </TouchableOpacity>
          ) : null}

          {/* Return Products — Odoo-style refund. Rendered ONLY when the
              order is eligible: already-refunded / refund-of / non-paid
              orders hide the chip entirely so the cashier never sees an
              option that won't work. Mirrors the Odoo POS Order form. */}
          {canRefund ? (
            <TouchableOpacity
              onPress={handleReturnProducts}
              disabled={refunding}
              activeOpacity={0.85}
              style={[
                s.invoiceChip,
                { borderColor: '#FECACA' },
                refunding && { opacity: 0.55 },
              ]}
            >
              <View style={s.invoiceChipIcon}>
                {refunding ? (
                  <ActivityIndicator color="#B91C1C" size="small" />
                ) : (
                  <MaterialIcons name="keyboard-return" size={20} color="#B91C1C" />
                )}
              </View>
              <Text style={s.invoiceChipText}>Return Products</Text>
            </TouchableOpacity>
          ) : null}

          {/* Payment — shown on an unpaid refund order (like Odoo's refund
              order form). Opens the pay flow so the cashier pays out the return. */}
          {isUnpaidRefund ? (
            <TouchableOpacity
              onPress={handlePayRefund}
              activeOpacity={0.85}
              style={[s.invoiceChip, { borderColor: '#BBF7D0' }]}
            >
              <View style={s.invoiceChipIcon}>
                <MaterialIcons name="payments" size={20} color="#166534" />
              </View>
              <Text style={s.invoiceChipText}>Payment</Text>
            </TouchableOpacity>
          ) : null}

          {/* Location chip — opens the same popup as the post-payment
              receipt. Disabled (greyed) when this order didn't capture
              GPS (placed before the feature shipped, or permission was
              denied that day). */}
          {(() => {
            const hasLocation = !!(
              order?.order_location_name ||
              (order?.order_latitude != null && order?.order_longitude != null)
            );
            return (
              <TouchableOpacity
                onPress={() => {
                  console.log('[POSLocation] chip tap', {
                    hasLocation,
                    location_name: order?.order_location_name,
                    latitude: order?.order_latitude,
                    longitude: order?.order_longitude,
                  });
                  if (!hasLocation) {
                    Toast.show({ type: 'info', text1: 'No location', text2: 'This order has no captured GPS data.' });
                    return;
                  }
                  setLocationModalVisible(true);
                }}
                activeOpacity={0.85}
                style={[s.invoiceChip, { borderColor: '#E9D5FF' }, !hasLocation && { opacity: 0.45 }]}
              >
                <View style={s.invoiceChipIcon}>
                  <MaterialIcons name="place" size={20} color="#9333ea" />
                </View>
                <Text style={s.invoiceChipText}>Location</Text>
              </TouchableOpacity>
            );
          })()}
        </View>
      </ScrollView>

      {/* Preview modal — full-screen WebView showing the rendered receipt. */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <SafeAreaViewNative style={{ flex: 1, backgroundColor: '#fff' }} edges={['top']}>
          <View style={s.previewHeader}>
            <Text style={s.previewTitle}>Print Preview</Text>
            <TouchableOpacity
              onPress={() => setPreviewVisible(false)}
              style={s.previewClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="close" size={22} color="#1a1a2e" />
            </TouchableOpacity>
          </View>
          <WebView
            originWhitelist={['*']}
            source={{ html: previewHtml }}
            style={{ flex: 1, backgroundColor: '#fff' }}
          />
        </SafeAreaViewNative>
      </Modal>

      {/* Shared Location modal — same look as the post-payment receipt. */}
      <LocationModal
        isVisible={locationModalVisible}
        locationName={order?.order_location_name}
        latitude={order?.order_latitude}
        longitude={order?.order_longitude}
        onClose={() => setLocationModalVisible(false)}
      />

      {/* Shared Tax-breakdown modal — same component used on the Orders list.
          Lines are already hydrated on this screen so no lazy fetch needed. */}
      <TaxBreakdownModal
        isVisible={taxModalVisible}
        order={order}
        currency={currency}
        onClose={() => setTaxModalVisible(false)}
      />

      {/* Paper-size picker — fires before Preview / Download / Print so the
          cashier can re-render the receipt at 2"/3"/3.5"/4" thermal widths. */}
      <PaperSizeModal
        isVisible={!!sizePicker}
        {...((paperCfg?.presets || []).length ? { sizes: paperCfg.presets.map((p) => ({ inch: p.label, mm: p.mm })) } : {})}
        onSelect={(mm, height = 0) => {
          const action = sizePicker;
          setSizePicker(null);
          if (action === 'preview') runPreview(mm, height);
          else if (action === 'download') runDownload(mm, height);
          else if (action === 'print') runPrint(mm, height);
        }}
        onCancel={() => setSizePicker(null)}
      />

      {/* Return Products confirmation popup — styled like LogoutModal /
          Close Register: navy-bordered white card, red icon disk, Cancel
          (navy outline) + Return (red filled). Replaces the native Alert. */}
      <Modal
        visible={returnConfirmVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setReturnConfirmVisible(false)}
      >
        <View style={s.returnConfirmBg}>
          <View style={s.returnConfirmCard}>
            <View style={s.returnConfirmIconDisk}>
              <MaterialIcons name="keyboard-return" size={28} color="#B91C1C" />
            </View>
            <Text style={s.returnConfirmTitle}>Return Products?</Text>
            <Text style={s.returnConfirmText}>
              {`A new refund order will be created for ${order?.name || 'this order'} with negative quantities and shown in the Orders list, ready for payment.`}
            </Text>
            <View style={s.returnConfirmBtnRow}>
              <TouchableOpacity
                onPress={() => setReturnConfirmVisible(false)}
                style={[s.returnConfirmBtn, s.returnConfirmBtnGhost]}
                activeOpacity={0.85}
              >
                <Text style={s.returnConfirmBtnGhostText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmReturnProducts}
                style={[s.returnConfirmBtn, s.returnConfirmBtnDanger]}
                activeOpacity={0.85}
              >
                <Text style={s.returnConfirmBtnDangerText}>RETURN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Invalid Operation — session closed. Mirrors Odoo's dialog: big
          left-aligned title, X in the corner, message, and a Close button. */}
      <Modal
        visible={!!invalidOpMsg}
        animationType="fade"
        transparent
        onRequestClose={() => setInvalidOpMsg('')}
      >
        <View style={s.invalidOpBg}>
          <View style={s.invalidOpCard}>
            <View style={s.invalidOpHeader}>
              <Text style={s.invalidOpTitle}>Invalid Operation</Text>
              <TouchableOpacity
                onPress={() => setInvalidOpMsg('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>
            <Text style={s.invalidOpBody}>{invalidOpMsg}</Text>
            <TouchableOpacity
              onPress={() => setInvalidOpMsg('')}
              style={s.invalidOpBtn}
              activeOpacity={0.85}
            >
              <Text style={s.invalidOpBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default OrderDetailScreen;

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBar: {
    backgroundColor: NAVY,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  topTitle: {
    flex: 1, textAlign: 'center',
    color: '#fff', fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
  },

  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  successDisk: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
  },
  orderName: { fontSize: 17, color: NAVY, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.2 },
  receiptText: { fontSize: 12, color: MUTED, marginTop: 2, fontFamily: FONT_FAMILY.urbanistMedium },
  statusPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.3 },

  metaRow: { flexDirection: 'row', marginTop: 8, gap: 12 },
  metaCell: { flex: 1 },
  metaLabel: {
    fontSize: 10, color: MUTED,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
  },
  metaValue: {
    fontSize: 13, color: '#1a1a2e',
    fontFamily: FONT_FAMILY.urbanistBold,
    marginTop: 2, letterSpacing: 0.2,
  },

  sectionTitle: {
    fontSize: 11, color: MUTED,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
    marginLeft: 4, marginBottom: 6,
  },

  linesCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 4,
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  lineRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F1F2F6',
  },
  lineThumbWrap: { width: 44, height: 44 },
  lineThumb: { width: 44, height: 44, borderRadius: 8 },
  lineName: { fontSize: 13, color: '#1a1a2e', fontFamily: FONT_FAMILY.urbanistBold },
  lineMeta: { fontSize: 12, color: MUTED, marginTop: 2, fontFamily: FONT_FAMILY.urbanistMedium },
  // Bidi-safe meta row — each fragment lives in its own Text so the RN
  // text engine doesn't reorder around the Arabic currency symbol.
  lineMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 },
  lineMetaQty: {
    fontSize: 12, color: MUTED, fontFamily: FONT_FAMILY.urbanistMedium,
    writingDirection: 'ltr',
  },
  lineMetaPrice: {
    fontSize: 12, color: '#475569', fontFamily: FONT_FAMILY.urbanistMedium,
    writingDirection: 'ltr',
  },
  lineMetaDiscount: {
    fontSize: 11, color: '#b45309', fontFamily: FONT_FAMILY.urbanistBold,
    backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 6, overflow: 'hidden',
  },
  lineSubtotal: {
    fontSize: 13, color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginLeft: 8,
  },

  totalsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    // Stack-spacing — the Totals and Payments cards both reuse this style
    // and render back-to-back in the ScrollView; without the bottom margin
    // they sit flush against each other and look like one bleeding card.
    // Mirrors `linesCard.marginBottom`.
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: MUTED, fontFamily: FONT_FAMILY.urbanistMedium },
  totalValue: { fontSize: 13, color: '#1a1a2e', fontFamily: FONT_FAMILY.urbanistBold },
  divider: { height: 1, backgroundColor: '#F1F2F6', marginVertical: 8 },
  grandLabel: { fontSize: 15, color: NAVY, fontFamily: FONT_FAMILY.urbanistBold },
  grandValue: { fontSize: 17, color: ORANGE, fontFamily: FONT_FAMILY.urbanistBold },

  // Customer Due card — the amber "money owed" treatment already used by
  // `splitBadge` below and by the POS payment screen's Previous Due card, so
  // the two screens read as one feature. Layered over `totalsCard` so it keeps
  // the same radius, padding and stack spacing as Totals and Payments.
  dueCard: { backgroundColor: DUE_BG, borderWidth: 1, borderColor: DUE_BORDER },
  dueHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dueTitle: {
    fontSize: 11,
    color: DUE_FG,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
    marginLeft: 6,
  },
  dueLabel: { fontSize: 13, color: DUE_FG, fontFamily: FONT_FAMILY.urbanistMedium },
  dueValue: { fontSize: 13, color: DUE_FG, fontFamily: FONT_FAMILY.urbanistBold },
  dueDivider: { height: 1, backgroundColor: DUE_BORDER, marginVertical: 8 },
  dueGrandLabel: { fontSize: 15, color: DUE_FG, fontFamily: FONT_FAMILY.urbanistBold },
  dueGrandValue: { fontSize: 17, color: DUE_FG, fontFamily: FONT_FAMILY.urbanistBold },

  // Payments card — header row with title + optional split badge
  paymentsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  splitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEDD5',
    borderColor: '#FED7AA',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  splitBadgeText: {
    fontSize: 11,
    color: '#9A3412',
    fontFamily: FONT_FAMILY.urbanistBold,
    marginLeft: 4,
    letterSpacing: 0.3,
  },

  // Invoice action buttons (Preview / Download / Print)
  invoiceActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  invoiceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
    }),
  },
  invoiceChipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  invoiceChipText: {
    fontSize: 12,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },

  // Preview modal — header bar + close button
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F2F6',
  },
  previewTitle: {
    fontSize: 15,
    color: '#1a1a2e',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  previewClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F2F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Refund chip + "Refunded from {original}" link in the hero card ──────
  refundChip: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  refundChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B91C1C',
    letterSpacing: 0.6,
  },
  refundedFromLink: {
    fontSize: 12,
    color: '#1E88E5',
    textDecorationLine: 'underline',
  },

  // ── Return Products confirmation modal — LogoutModal-style ───────────────
  // Invalid Operation popup — Odoo-style dialog.
  invalidOpBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  invalidOpCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 22,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  invalidOpHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  invalidOpTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    paddingRight: 12,
  },
  invalidOpBody: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginBottom: 22,
  },
  invalidOpBtn: {
    alignSelf: 'flex-start',
    backgroundColor: NAVY,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  invalidOpBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },

  returnConfirmBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  returnConfirmCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: NAVY,
    paddingVertical: 22,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  returnConfirmIconDisk: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  returnConfirmTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1a1a2e',
    textAlign: 'center',
    marginBottom: 8,
  },
  returnConfirmText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  returnConfirmBtnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  returnConfirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  returnConfirmBtnGhost: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: NAVY,
  },
  returnConfirmBtnGhostText: {
    color: NAVY,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  returnConfirmBtnDanger: {
    backgroundColor: '#B91C1C',
  },
  returnConfirmBtnDangerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
