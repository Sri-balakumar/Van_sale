import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ActivityIndicator, TouchableOpacity, ScrollView, StyleSheet,
  StatusBar, Platform, Dimensions, Alert, Modal, TextInput, Linking,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from '@components/containers';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import {
  fetchPaymentJournalsOdoo, createAccountPaymentOdoo, registerPaymentForInvoiceOdoo, fetchPOSSessions,
  createInvoiceOdoo, linkInvoiceToPosOrderOdoo,
  fetchPosConfigPaymentMethods,
  fetchPartnerIdProofOdoo,
  fetchPartnerOutstandingOdoo,
  captureOrderDueOdoo,
  updatePosOrderSignaturesOdoo,
  submitPosOrderToOdoo,
  getCurrentDeviceLocation,
  writeOrderLocationOdoo,
  fetchPosOrderRefOdoo,
  // Discard a pre-existing draft (from TakeoutDelivery's Place Order)
  // before re-submitting via sync_from_ui. The legacy 4-step manual
  // flow (create → payment → write → action_paid) does NOT reliably
  // create the stock.picking, so on-hand never decremented. sync_from_ui
  // does, so we route every paid order through that single path.
  deletePosOrderOdoo,
  fetchProductTaxMap,
} from '@api/services/generalApi';
import { IdProofCards } from '@components/IdProof';
import { SignatureCapturePopup, SignatureCards } from '@components/Signature';
// react-native-modal — used here for the ID-proof popup so it animates
// in like LogoutModal (slide-up + dimmed backdrop) instead of the
// instant fade the built-in `Modal` gives us.
import RNModal from 'react-native-modal';
import axios from 'axios';
import { getOdooUrl, getOdooDb } from '@api/config/odooConfig';
import { useProductStore } from '@stores/product';
import { useAuthStore } from '@stores/auth';
import { formatCurrency, getDigits } from '@utils/currency';
import Toast from 'react-native-toast-message';

// The default export from odooConfig is an empty string (runtime URL is only
// available via getOdooUrl()). Use a helper so every call below hits the
// authenticated host the user logged into.
const odooHeaders = () => {
  const db = getOdooDb();
  return {
    'Content-Type': 'application/json',
    ...(db ? { 'X-Odoo-Database': db } : {}),
  };
};

const NAVY = COLORS.primaryThemeColor;
const NAVY_LIGHT = '#3d3768';
const ORANGE = '#F47B20';

// Render a money value with the Odoo-configured company currency.
const displayNum = (n) => formatCurrency(n);

// Helper to fetch payment method id for a journal
const fetchPaymentMethodId = async (journalId) => {
  try {
    const response = await axios.post(`${getOdooUrl()}/web/dataset/call_kw`, {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        model: 'pos.payment.method',
        method: 'search_read',
        args: [[['journal_id', '=', journalId]]],
        kwargs: { fields: ['id', 'name', 'journal_id'], limit: 1 },
      },
    }, { headers: { 'Content-Type': 'application/json' } });
    const paymentMethodId = response.data?.result?.[0]?.id;
    if (paymentMethodId) {
      console.log('Fetched payment_method_id for journal', journalId, ':', paymentMethodId);
    } else {
      console.log('No payment_method_id found for journal', journalId);
    }
    return paymentMethodId;
  } catch (e) {
    console.error('Error fetching payment_method_id:', e);
    return null;
  }
};

const POSPayment = ({ navigation, route }) => {
  // Subscribe so the screen re-renders when the currency hydrates / changes.
  useAuthStore((s) => s.currency);
  // Pre-warm: kick off the FULL location fetch (coords + reverse-geocode)
  // on mount and stash the in-flight promise. By the time the cashier taps
  // Validate Payment a few seconds later, this has usually resolved and the
  // payment handler can use the cached result instead of starting a fresh
  // 15-30s cascade. Fire-and-forget — failures fall through to the
  // handler's own fetch + the existing error UI.
  const prewarmLocationRef = useRef(null);
  useEffect(() => {
    prewarmLocationRef.current = getCurrentDeviceLocation();
    prewarmLocationRef.current
      .then((r) => console.log('[POSLocation] pre-warm done', r?.error || 'ok'))
      .catch(() => {});
  }, []);

  // Invoice defaults to ON — accounting wants an invoice on every sale.
  // Tapping the button to uncheck triggers a confirmation modal that
  // explains the tax-reconciliation risk before flipping it off.
  const [invoiceChecked, setInvoiceChecked] = useState(true);
  const [invoiceUncheckModalVisible, setInvoiceUncheckModalVisible] = useState(false);
  // "With Tax" toggle — defaults to ON so existing tax-bearing products
  // continue to display their server-computed tax. Flipping it OFF tells
  // submitPosOrderToOdoo to override product.taxes_id with an empty set
  // per line, so Odoo books a zero-tax order (receipt/invoice/accounting
  // all stay aligned with what the cashier sees on screen).
  const [withTaxMode, setWithTaxMode] = useState(true);
  // Optional Payment Reference (like Odoo's Register Payment popup). Stored as
  // the pos.payment name so it shows on the payment record.
  const [paymentReference, setPaymentReference] = useState('');
  // Map of product.product id → { rate, priceInclude } for the cart's
  // products. Hydrated lazily on mount via fetchProductTaxMap so we can
  // render a real tax row in the totals breakdown.
  const [productTaxMap, setProductTaxMap] = useState({});
  const [amountModalVisible, setAmountModalVisible] = useState(false);
  const [customerModalVisible, setCustomerModalVisible] = useState(false);
  const {
    products = [],
    customer: initialCustomer,
    sessionId,
    registerName,
    totalAmount,
    orderId,
    discountAmount = 0,
  } = route?.params || {};
  const [customer, setCustomer] = useState(initialCustomer);

  // ID-proof verification state for the selected customer. Loaded the
  // moment a customer is picked so the chip can flip from "Add" to
  // "Verified" without an extra fetch round-trip when the cashier taps
  // it. `loaded` flips true after at least one fetch attempt so we can
  // distinguish "still loading" from "definitely missing".
  const [idProof, setIdProof] = useState({ front: null, back: null, loaded: false });
  const [idProofModalVisible, setIdProofModalVisible] = useState(false);

  // Per-sale signatures (shop owner + customer), captured at checkout and
  // saved against the new pos.order as ir.attachment (same storage as ID
  // proof). The popup rises automatically when a customer is selected.
  const [signatures, setSignatures] = useState({ owner: null, customer: null });
  const [sigPopupVisible, setSigPopupVisible] = useState(false);
  const setSignature = (role, b64) =>
    setSignatures((prev) => ({ ...prev, [role]: b64 }));

  const openCustomerSelector = () => {
    navigation.navigate('CustomerScreen', {
      selectMode: true,
      onSelect: (selected) => {
        setCustomer(selected);
        // Rise the signature popup right after a customer is chosen so the
        // cashier captures the customer + shop-owner signatures up front.
        if (selected) setSigPopupVisible(true);
      },
    });
  };
  const [journals, setJournals] = useState([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  // Inline "pay now via" selector inside Credit mode. When set to 'cash'
  // or 'card' the cashier is doing a partial split — the typed amount
  // goes to that method NOW, the remainder posts to Credit. Null means
  // full Credit (charge everything to the customer's account).
  const [creditNowMethod, setCreditNowMethod] = useState(null);
  useEffect(() => {
    if (paymentMode === 'account') {
      console.log('Journals available for account payment:', journals);
    }
  }, [paymentMode, journals]);

  // Pull the selected customer's ID-proof binaries the moment they're
  // picked. The chip below the customer card uses these to flip
  // between "ID Proof on file" (green) and "Add ID Proof" (amber).
  useEffect(() => {
    let alive = true;
    const partnerId = customer?.id || customer?._id;
    if (!partnerId) {
      setIdProof({ front: null, back: null, loaded: false });
      return undefined;
    }
    setIdProof({ front: null, back: null, loaded: false });
    fetchPartnerIdProofOdoo(partnerId)
      .then((res) => {
        if (!alive) return;
        setIdProof({
          front: res?.id_proof_front || null,
          back: res?.id_proof_back || null,
          loaded: true,
        });
      })
      .catch(() => {
        if (alive) setIdProof({ front: null, back: null, loaded: true });
      });
    return () => { alive = false; };
  }, [customer?.id, customer?._id]);

  // Selected customer's outstanding balance, so the salesman can ask for the
  // old money BEFORE collecting for this order. No order exists yet at this
  // point, so the whole open receivable IS the previous due — nothing to
  // exclude. Re-fetches when the customer is swapped mid-sale via
  // openCustomerSelector. `loaded` distinguishes "still fetching" from
  // "definitely owes nothing", same convention as idProof above.
  const [outstanding, setOutstanding] = useState({ amount: 0, loaded: false });
  useEffect(() => {
    let alive = true;
    const partnerId = customer?.id || customer?._id;
    if (!partnerId) {
      setOutstanding({ amount: 0, loaded: false });
      return undefined;
    }
    setOutstanding({ amount: 0, loaded: false });
    fetchPartnerOutstandingOdoo({ partnerId })
      .then((res) => {
        if (!alive) return;
        setOutstanding({ amount: Number(res?.previousDue) || 0, loaded: true });
      })
      .catch(() => {
        if (alive) setOutstanding({ amount: 0, loaded: true });
      });
    return () => { alive = false; };
  }, [customer?.id, customer?._id]);
  const [selectedJournal, setSelectedJournal] = useState(null);
  const [paying, setPaying] = useState(false);

  // Discount popup state. Two segmented toggles — Type (Total / Items)
  // and Format (Percentage / Amount) — drive the same underlying
  // "computedDiscountAmount" so every downstream calc reads one number.
  // discountType is currently visual-only (both modes ship the same
  // uniform per-line % to Odoo); the toggle is wired so a future
  // per-item-picking flow can drop in without state changes here.
  const [taxDetailsModalVisible, setTaxDetailsModalVisible] = useState(false);
  const [discountModalVisible, setDiscountModalVisible] = useState(false);
  const [discountType, setDiscountType] = useState('total');          // 'total' | 'items'
  const [discountFormat, setDiscountFormat] = useState('percentage'); // 'percentage' | 'amount'
  const [discountPercent, setDiscountPercent] = useState(0);          // 0-100, when format='percentage'
  const [discountAmountValue, setDiscountAmountValue] = useState(0);  // OMR, when format='amount'
  const [customDiscountInput, setCustomDiscountInput] = useState('');
  const { clearProducts } = useProductStore();
  const [inputAmount, setInputAmount] = useState('');

  // Split (partial) payment state — popup with two slots; each slot picks
  // ANY pos.payment.method configured on the active register (cash, card,
  // customer-account/credit, etc.). `splitConfirmed` flips true once the
  // cashier confirms a valid split, gating the orange Validate button.
  const [splitModalVisible, setSplitModalVisible] = useState(false);
  const [splitSlot1, setSplitSlot1] = useState({ methodKey: 'cash', amount: '' });
  const [splitSlot2, setSplitSlot2] = useState({ methodKey: 'card', amount: '' });
  const [splitConfirmed, setSplitConfirmed] = useState(false);

  // Active POS config + its configured payment methods. Resolved once on
  // mount so the partial-payment popup can render its method chips before
  // the user taps Validate. Also reused by handlePay so it doesn't have to
  // re-resolve the config from the session list on each pay.
  const [posConfigId, setPosConfigId] = useState(
    route?.params?.registerId || route?.params?.posConfigId || null
  );
  const [posPaymentMethods, setPosPaymentMethods] = useState([]);

  // Map journals to Odoo-style payment modes (cash / card / customer account)
  const getJournalForMode = (mode) => {
    if (!journals || journals.length === 0) return null;
    const byName = (name) => journals.find((j) => j.name && j.name.toLowerCase().includes(name));
    if (mode === 'cash') {
      return journals.find((j) => j.id === 16) || journals.find((j) => j.type === 'cash') || byName('cash') || journals.find((j) => j.type === 'cashbox');
    }
    if (mode === 'card') {
      return journals.find((j) => j.type === 'bank') || byName('card') || byName('visa') || byName('master');
    }
    if (mode === 'account') {
      return journals.find((j) => j.type === 'sale') || journals.find((j) => j.type === 'receivable') || byName('account') || journals[0];
    }
    return null;
  };

  // When payment mode or journals change, automatically pick the corresponding journal
  useEffect(() => {
    const j = getJournalForMode(paymentMode);
    console.log('Mapping result for mode', paymentMode, j);
    setSelectedJournal(j);
  }, [paymentMode, journals]);

  // Resolve posConfigId once on mount: prefer route params, fall back to
  // looking up the session's config_id. Done here (not inside handlePay) so
  // the partial-payment popup can pre-fetch payment-method chips.
  useEffect(() => {
    let mounted = true;
    if (posConfigId || !sessionId) return;
    (async () => {
      try {
        const sessionList = await fetchPOSSessions({ limit: 10, offset: 0, state: '' });
        const session = sessionList.find((s) => s.id === sessionId);
        const cid = session?.config_id
          ? (Array.isArray(session.config_id) ? session.config_id[0] : session.config_id)
          : null;
        if (mounted && cid) setPosConfigId(cid);
      } catch (e) {
        console.warn('Failed to resolve posConfigId from session:', e?.message || e);
      }
    })();
    return () => { mounted = false; };
  }, [sessionId]);

  // Pull pos.payment.method records configured on the active register.
  // handlePay resolves the cashier's chip selection (cash / card / credit)
  // to one of these records at submit time — the split modal itself renders
  // a fixed three-chip row independent of this list.
  useEffect(() => {
    let mounted = true;
    if (!posConfigId) return;
    (async () => {
      try {
        const methods = await fetchPosConfigPaymentMethods(posConfigId);
        if (!mounted) return;
        setPosPaymentMethods(methods || []);
      } catch (e) {
        console.warn('Failed to load pos.payment.method records:', e?.message || e);
      }
    })();
    return () => { mounted = false; };
  }, [posConfigId]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const list = await fetchPaymentJournalsOdoo();
        console.log('Fetched journals from Odoo:', list);
        if (mounted) setJournals(list);
      } catch (e) {
        console.warn('Failed to load journals', e?.message || e);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    console.log('POSPayment params:', route?.params);
  }, []);

  // Hydrate the product → tax-rate map for the products currently in the
  // cart. The Tax row in the totals breakdown reads from this, so until
  // the fetch settles the row simply doesn't appear (no flash, no NaN).
  useEffect(() => {
    let mounted = true;
    const ids = (products || [])
      .map((p) => Number(p.remoteId || p.id))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return undefined;
    fetchProductTaxMap(ids)
      .then((map) => {
        console.log('[WithTax] tax map fetched', { ids, map });
        if (mounted) setProductTaxMap(map || {});
      })
      .catch((e) => { console.warn('[WithTax] tax map fetch failed', e?.message || e); });
    return () => { mounted = false; };
  }, []);

  // Subtotal = naive sum of price × qty across cart. The `total`
  // (after discount) is what every downstream calculation reads.
  const subtotal = (products || []).reduce((s, p) => s + ((p.price || 0) * (p.quantity || p.qty || 0)), 0);
  // Only apply the local discount when we're creating a fresh order.
  // If `totalAmount` arrives from a prior screen it's already the
  // authoritative number — don't double-apply.
  const totalIsExternal = totalAmount !== undefined && totalAmount !== null;
  // Resolve the discount amount from whichever format is active.
  // Amount mode is clamped to subtotal so the cashier can't push the
  // total negative.
  const computedDiscountAmount = totalIsExternal
    ? 0
    : discountFormat === 'amount'
      ? Math.min(subtotal, Math.round(Number(discountAmountValue || 0) * 1000) / 1000)
      : Math.round((subtotal * discountPercent / 100) * 1000) / 1000;
  // Effective per-line % we ship to Odoo regardless of which UI format
  // the cashier used. Always derived from the resolved amount so % and
  // amount paths converge.
  const effectiveDiscountPercent = subtotal > 0
    ? Math.round((computedDiscountAmount / subtotal) * 1000000) / 10000  // 4-decimal precision
    : 0;
  // Single source of truth for per-line tax. The IIFE-summed total and the
  // Tax Details popup both call this so they can never disagree.
  // price_include products already carry the tax inside `price`, so the
  // visible tax = gross - gross / (1 + rate/100). Tax-exclusive: rate × gross.
  const computeLineTax = (p) => {
    // Return lines carry LOCKED tax read from the original order details
    // (incl − excl); it's fixed regardless of the With Tax toggle. When the
    // item was bought without tax, lockedTaxAmount is 0 → stays normal.
    if (p.isReturnLine) {
      // Locked ORIGINAL tax rate applied to the CURRENT returned quantity, so
      // the tax reflects only what's being returned (scales if qty changes).
      const price = Number(p.price) || 0;
      const qty = Number(p.quantity || p.qty || 0);
      const gross = price * qty * (1 - (effectiveDiscountPercent || 0) / 100);
      const rate = Number(p.lockedTaxRate) || 0;
      const tax = gross * rate;
      return { info: { rate: rate ? Math.round(rate * 100) : null, priceInclude: false, locked: true }, gross, tax, lineTotal: gross + tax };
    }
    const info = productTaxMap[Number(p.remoteId || p.id)];
    if (!info || !info.rate) return { info, gross: 0, tax: 0, lineTotal: 0 };
    const price = Number(p.price) || 0;
    const qty = Number(p.quantity || p.qty || 0);
    const gross = price * qty * (1 - (effectiveDiscountPercent || 0) / 100);
    const tax = info.priceInclude
      ? gross - gross / (1 + info.rate / 100)
      : gross * info.rate / 100;
    const lineTotal = info.priceInclude ? gross : gross + tax;
    return { info, gross, tax, lineTotal };
  };

  // Tax amount — sum across cart. Toggle off → 0, so it disappears from
  // the breakdown AND we ship tax_ids=[] to Odoo.
  const taxAmount = (() => {
    let sum = 0;
    for (const p of products || []) {
      // Return lines are always counted (locked); new lines only when the
      // With Tax toggle is on. computeLineTax handles the return-line rate.
      if (p.isReturnLine || withTaxMode) sum += computeLineTax(p).tax;
    }
    return Math.round(sum * 1000) / 1000;
  })();
  // If every taxed line in the cart shares the same rate we can annotate
  // the Tax row in the breakdown with that rate (parallels the existing
  // Discount (15%) styling). Mixed-rate carts get a plain "Tax" label —
  // the per-line popup is where the full breakdown lives.
  const commonTaxRate = (() => {
    let r = null;
    for (const p of products || []) {
      // Return lines always count; new lines only when With Tax is on.
      let rate = null;
      if (p.isReturnLine) {
        rate = computeLineTax(p).info?.rate || null;
      } else if (withTaxMode) {
        rate = productTaxMap[Number(p.remoteId || p.id)]?.rate || null;
      }
      if (!rate) continue;
      if (r === null) { r = rate; continue; }
      if (rate !== r) return null;
    }
    return r;
  })();
  const computeTotal = () => {
    // For price-inclusive taxes the tax is already inside `price`, so adding
    // `taxAmount` would double-count. Treat any cart containing one or more
    // price-inclusive lines as "tax already in the base" and skip the
    // addition — the Tax row in the breakdown is then informational, not
    // additive. Applies in both the external-total and locally-computed paths.
    const hasInclusive = withTaxMode && (products || []).some((p) => {
      const info = productTaxMap[Number(p.remoteId || p.id)];
      return info && info.priceInclude && info.rate > 0;
    });
    const base = totalIsExternal
      ? Number(totalAmount) || 0
      : subtotal - computedDiscountAmount;
    return hasInclusive ? base : base + (taxAmount || 0);
  };
  const total = computeTotal();
  // Refund flow: when the order total is negative, treat the entered amount
  // as money going out (negative payment). The cashier still types positive
  // digits on the keypad; we flip the sign internally so the Remaining/Change
  // badge and the displayed entered amount read correctly.
  const isRefund = total < 0;
  const paidAmountRaw = parseFloat(inputAmount) || 0;
  const paidAmount = isRefund ? -Math.abs(paidAmountRaw) : paidAmountRaw;
  const remaining = total - paidAmount;

  // Round to the displayed currency precision before any amount comparison.
  // The cashier types the value they SEE (formatCurrency rounds to
  // getDigits('Product Price')), but `total` carries un-rounded float residue
  // (un-rounded subtotal + 3dp tax), so a bare `paidAmount < total` wrongly
  // reads the correct amount as short. Comparing rounded values matches the
  // on-screen number. Mirrors the tolerance the split/credit checks already use.
  const roundMoney = (n) => {
    const f = Math.pow(10, getDigits('Product Price', 2));
    return Math.round((Number(n) || 0) * f) / f;
  };

  const handleKeypad = (val) => {
    if (val === 'C') return setInputAmount('');
    if (val === '⌫') return setInputAmount(inputAmount.slice(0, -1));
    if (val === '+10') return setInputAmount(((parseFloat(inputAmount) || 0) + 10).toString());
    if (val === '+20') return setInputAmount(((parseFloat(inputAmount) || 0) + 20).toString());
    if (val === '+50') return setInputAmount(((parseFloat(inputAmount) || 0) + 50).toString());
    if (val === '+/-') {
      if (inputAmount.startsWith('-')) setInputAmount(inputAmount.slice(1));
      else setInputAmount('-' + inputAmount);
      return;
    }
    if (val === '.') {
      if (!inputAmount.includes('.')) setInputAmount(inputAmount + '.');
      return;
    }
    setInputAmount(inputAmount + val);
  };

  const keypadRows = [
    ['1', '2', '3', '+10'],
    ['4', '5', '6', '+20'],
    ['7', '8', '9', '+50'],
    ['+/-', '0', '.', '⌫'],
  ];

  const handlePay = async () => {
    console.log('Customer before payment:', customer);
    console.log('Journal before payment:', selectedJournal);
    // Flow trace — captures every key checkpoint inside handlePay so we
    // can see exactly where the chain breaks. The finally below always
    // fires one Alert with trace.join('\n'), regardless of success,
    // exception, or early return. Beats per-step Alerts that get bypassed
    // when something earlier in the chain throws.
    const trace = [];
    const push = (s) => { trace.push(s); console.log('[handlePay]', s); };
    push('start');
    setPaying(true);
    try {
      // Strict location gate. The receipt must always carry a real fix
      // captured at the moment of payment — no "Location unavailable —
      // tap to retry" placeholder. If services are off or permission is
      // denied, popup with an Open Settings button (Google-Maps style)
      // and BLOCK the payment. If the device truly can't get a fix
      // (no_fix), give the cashier a one-tap "Save without location"
      // option so we never trap them.
      // Use the pre-warmed location if it is ready or completes within 5s.
      // If the pre-warm is slow (cold start, lock-screen tap), fall back to a
      // fresh getCurrentDeviceLocation — which itself benefits from the OS
      // last-known cache the pre-warm has already populated, so it usually
      // returns from stage 2a (lastKnown) almost instantly.
      let fix;
      const prewarmPromise = prewarmLocationRef.current;
      const PREWARM_SENTINEL = Symbol('prewarm-timeout');
      if (prewarmPromise) {
        const raceResult = await Promise.race([
          prewarmPromise,
          new Promise((r) => setTimeout(() => r(PREWARM_SENTINEL), 5000)),
        ]);
        fix = raceResult === PREWARM_SENTINEL
          ? await getCurrentDeviceLocation()
          : raceResult;
      } else {
        fix = await getCurrentDeviceLocation();
      }
      console.log('[POSLocation] gate result in handlePay:', JSON.stringify(fix));
      if (fix?.error === 'no_fix') {
        const proceedWithoutLocation = await new Promise((resolve) => {
          Alert.alert(
            'Location not ready',
            "Couldn't get device location after several attempts. Save the order without location?",
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Save without location', onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });
        if (!proceedWithoutLocation) { push('location: cancel return'); setPaying(false); return; }
        push('location: no_fix proceeding (skipped)');
        // Mark fix so downstream knows to skip the writeOrderLocationOdoo call.
        fix = { error: 'no_fix', skipped: true };
      } else if (fix?.error) {
        // services_off / permission_denied / expo_missing — block with an
        // Alert that points to the OS settings the user can fix. (no_fix
        // was already handled above with the opt-in flow.)
        if (fix.error === 'services_off' || fix.error === 'permission_denied') {
          const isOff = fix.error === 'services_off';
          Alert.alert(
            isOff ? 'Turn on location' : 'Allow location access',
            isOff
              ? 'Location services are off on this device. Turn them on to complete payment.'
              : 'This app needs location permission to record where the sale happened. Open settings to allow it.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => { Linking.openSettings(); } },
            ],
          );
        } else {
          Toast.show({
            type: 'error',
            text1: 'Location unavailable',
            text2: 'Location service error. Try again.',
          });
        }
        push(`location: blocked (${fix?.error || 'unknown'}) return`);
        setPaying(false);
        return;
      }
      if (!fix?.skipped && !fix?.error) push('location: ok fix-acquired');

      const lines = products.map((p) => ({
        // remoteId is the raw Odoo product id; `p.id` can be a prefixed cart
        // key like 'prod_74' from POSProducts.mapToStoreProduct. Postgres
        // rejects strings here because product_id is INTEGER.
        product_id: p.remoteId || p.id,
        qty: p.quantity,
        price: p.price,
        name: p.name || p.product_name || '',
        // Always ship as a flat per-line percentage — Odoo's
        // pos.order.line.discount is a percent. effectiveDiscountPercent
        // is derived from the resolved amount, so percentage and
        // amount input modes converge to the same payload here.
        discount: effectiveDiscountPercent || 0,
        customer_note: p.customer_note || '',
        // Return-line tax lock — forwarded so the submit builder keeps this
        // line's original tax rate regardless of the With Tax toggle.
        isReturnLine: !!p.isReturnLine,
        lockedTaxRate: p.lockedTaxRate,
        lockedTaxIds: p.lockedTaxIds,
      }));
      const partnerId = customer?.id || customer?._id || null;
      const companyId = 1;

      // posConfigId is resolved on mount (see useEffect above). Re-resolve
      // here only as a fallback in case the mount-time lookup was still in
      // flight or failed.
      let resolvedConfigId = posConfigId || route?.params?.registerId || route?.params?.posConfigId || null;
      if (!resolvedConfigId && sessionId) {
        try {
          const sessionList = await fetchPOSSessions({ limit: 10, offset: 0, state: '' });
          const session = sessionList.find((s) => s.id === sessionId);
          if (session && session.config_id) {
            resolvedConfigId = Array.isArray(session.config_id) ? session.config_id[0] : session.config_id;
          }
          console.log('[POS CONFIG] Fallback-resolved posConfigId:', resolvedConfigId);
        } catch (e) {
          console.warn('Failed to auto-fetch posConfigId from session:', e?.message || e);
        }
      }
      let createdOrderId = orderId || null;
      let invoiceInfo = null;
      let capturedLocation = null;
      let posReference = '';
      // Display label for the receipt's payment-method line. Computed from
      // the chosen method(s) at navigation time so the receipt renders the
      // right label on first paint instead of flashing "Cash" while waiting
      // for fetchPosOrderPaymentsOdoo to resolve.
      let paymentMethodLabel = '';
      // NOTE: the order is now submitted atomically inside the payment block
      // via submitPosOrderToOdoo (sync_from_ui on Odoo 18+, create_from_ui on 13-17),
      // which is the only entry point that reliably creates the stock.picking
      // that decrements qty_available. We no longer create a draft order up
      // front and then try to mark it paid — that path bypassed picking
      // creation on several Odoo versions and silently failed to move stock.

      if (paymentMode === 'cash' || paymentMode === 'card' || paymentMode === 'credit' || paymentMode === 'split') {
        try {
          // Resolve the payment method via the active pos.config rather than
          // the previously hard-coded journal id. The cashier-side Odoo POS
          // always picks payment methods from pos.config.payment_method_ids,
          // and each method already carries the correct journal — so this
          // works regardless of how journals are numbered in the user's DB.
          // Reuse the methods cached at mount time when available so we don't
          // hit the JSON-RPC endpoint twice in a row on Validate.
          const posMethods = posPaymentMethods.length > 0
            ? posPaymentMethods
            : await fetchPosConfigPaymentMethods(resolvedConfigId);
          console.log('[PAYMENT] pos.config payment methods:', posMethods);

          const cashMethod = posMethods.find((m) => m.is_cash_count === true);
          // Bank methods = card-style payment (immediate journal posting).
          // Excludes pay_later / split_transactions methods which are
          // Odoo's customer-account flag — those post to the partner's
          // receivable, not a bank journal.
          const bankMethods = posMethods.filter(
            (m) => m.is_cash_count === false
                && m.split_transactions !== true
                && m.type !== 'pay_later'
          );
          // Pay-later methods = Odoo's "Customer Account" payment methods.
          // type='pay_later' OR split_transactions=true marks them. These
          // are what we want for the Credit portion so the amount lands
          // on the partner's account.move.line as a receivable.
          const payLaterMethods = posMethods.filter(
            (m) => m.type === 'pay_later' || m.split_transactions === true
          );
          const findByName = (n) => bankMethods.find((m) => (m.name || '').toLowerCase() === n);
          const cardMethod = findByName('card') || bankMethods.find((m) => (m.name || '').toLowerCase() !== 'credit') || bankMethods[0];
          // Credit always resolves to a pay-later method when one is
          // configured on this register. Only fall back to a bank method
          // if the register has no pay_later method at all (legacy setup).
          const creditMethod =
            payLaterMethods.find((m) => /credit|customer\s*account|account|pay\s*later/i.test(m.name || ''))
            || payLaterMethods[0]
            || findByName('credit')
            || bankMethods[1] || bankMethods[0];

          const payments = [];

          if (paymentMode === 'split') {
            // Resolve each chip key to a real pos.payment.method using the
            // same chain the single-method branch below uses. On a register
            // that only has Cash configured, all three keys collapse onto
            // the cash method — same forgiving behaviour the cashier
            // already gets when tapping Card/Credit in normal mode.
            const resolveByKey = (key) => {
              if (key === 'cash') return cashMethod;
              if (key === 'card') return cardMethod;
              if (key === 'credit') return creditMethod;
              return cashMethod;
            };
            const anyMethod = posMethods.find((m) => m.split_transactions !== true) || posMethods[0];
            const slot1Method = resolveByKey(splitSlot1.methodKey) || anyMethod;
            const slot2Method = resolveByKey(splitSlot2.methodKey) || anyMethod;
            if (!slot1Method || !slot2Method) {
              Toast.show({
                type: 'error',
                text1: 'Payment Error',
                text2: 'No payment method is configured on this POS register. Add one in Odoo: Point of Sale → Configuration → Payment Methods.',
                position: 'bottom',
              });
              return;
            }
            const slot1JournalId = Array.isArray(slot1Method.journal_id) ? slot1Method.journal_id[0] : slot1Method.journal_id;
            const slot2JournalId = Array.isArray(slot2Method.journal_id) ? slot2Method.journal_id[0] : slot2Method.journal_id;
            payments.push({
              amount: parseFloat(splitSlot1.amount) || 0,
              paymentMethodId: slot1Method.id,
              journalId: slot1JournalId,
              paymentMode: 'split',
            });
            payments.push({
              amount: parseFloat(splitSlot2.amount) || 0,
              paymentMethodId: slot2Method.id,
              journalId: slot2JournalId,
              paymentMode: 'split',
            });
            paymentMethodLabel = `Split (${slot1Method.name} + ${slot2Method.name})`;
            console.log(`🪓 Split payment: ${slot1Method.name} ${payments[0].amount} + ${slot2Method.name} ${payments[1].amount} = ${total}`);
          } else {
            // Single-method (cash / card / credit) — existing flow.
            let method =
              paymentMode === 'cash'   ? cashMethod   :
              paymentMode === 'credit' ? creditMethod :
                                         cardMethod;
            if (!method && posMethods.length > 0) {
              method = posMethods.find((m) => m.split_transactions !== true) || posMethods[0];
            }
            if (!method) {
              Toast.show({
                type: 'error',
                text1: 'Payment Error',
                text2: 'No payment method is configured on this POS register. Add one in Odoo: Point of Sale → Configuration → Payment Methods.',
                position: 'bottom',
              });
              return;
            }
            const paymentMethodId = method.id;
            const journalId = Array.isArray(method.journal_id) ? method.journal_id[0] : method.journal_id;
            console.log('[PAYMENT] selected method:', { paymentMethodId, journalId, name: method.name });
            if (paymentMode === 'cash') {
              // One positive pos.payment row of `total`. Change lives in
              // pos.order.amount_return (computed by Odoo from
              // tendered-vs-total). We ship `state: 'draft'` from
              // submitPosOrderToOdoo and mark the order paid via a separate
              // action_pos_order_paid RPC AFTER sync_from_ui commits — this
              // lets compute fields (amount_paid from payment_ids) settle
              // before Odoo's _is_pos_order_paid check fires.
              payments.push({ amount: total, paymentMethodId, journalId, paymentMode });
              push(`cash: ${total} (tendered=${paidAmount} change=${Math.max(0, paidAmount - total)})`);
              console.log(`💵 Cash payment: Total=${total}, Received=${paidAmount}, Change=${Math.max(0, paidAmount - total)}`);
            } else if (paymentMode === 'card') {
              // Card charges exact total — no change concept.
              payments.push({ amount: total, paymentMethodId, journalId, paymentMode });
              push(`card: ${total}`);
              console.log(`💳 Card payment: Total=${total}`);
            } else if (paymentMode === 'credit') {
              // Inline credit-partial path — when a "Pay Now via" method is
              // picked and the now amount is between 0 and total, split the
              // payment into two pos.payment records: Cash/Card for now,
              // Credit for the due remainder. Otherwise fall through to
              // full Credit single payment (existing behaviour).
              const doPartial = !!creditNowMethod
                && creditNowAmount > 0
                && creditDueAmount > 0
                && !creditDueOverdrawn;
              console.log('[Payment] credit submit', {
                creditNowMethod,
                creditNowAmount,
                creditDueAmount,
                doPartial,
                customer: customer?.id || customer?._id,
              });
              if (doPartial) {
                const nowMethod = creditNowMethod === 'cash' ? cashMethod : cardMethod;
                if (!nowMethod) {
                  push(`partial-split: missing ${creditNowMethod} method on this register`);
                  Toast.show({
                    type: 'error',
                    text1: 'Payment Error',
                    text2: `${creditNowMethod === 'cash' ? 'Cash' : 'Card'} payment method is not configured on this register.`,
                    position: 'bottom',
                  });
                  return;
                }
                // Resolved "now" method — confirms which pos.payment.method
                // the cash/card slot picked up (id, journal, is_cash_count).
                console.log('[Payment] partial-pay nowMethod resolved:', {
                  id: nowMethod.id,
                  name: nowMethod.name,
                  is_cash_count: nowMethod.is_cash_count,
                  journal_id: nowMethod.journal_id,
                  type: nowMethod.type,
                });
                // Resolved Credit method — should be pay_later /
                // split_transactions=true for receivables to post correctly.
                console.log('[Payment] partial-pay creditMethod resolved:', {
                  id: method?.id,
                  name: method?.name,
                  type: method?.type,
                  split_transactions: method?.split_transactions,
                  journal_id: method?.journal_id,
                });
                const nowJournalId = Array.isArray(nowMethod.journal_id) ? nowMethod.journal_id[0] : nowMethod.journal_id;
                payments.length = 0; // reset to ensure clean 2-row split
                payments.push({
                  amount: creditNowAmount,
                  paymentMethodId: nowMethod.id,
                  journalId: nowJournalId,
                  paymentMode: creditNowMethod,
                });
                payments.push({
                  amount: creditDueAmount,
                  paymentMethodId,
                  journalId,
                  paymentMode: 'credit',
                });
                paymentMethodLabel = `${nowMethod.name} + ${method.name || 'Credit'}`;
                // Final 2-element payments array — confirms both rows have
                // distinct paymentMethodId + journalId before submit.
                console.log('[Payment] partial-pay final payments:', JSON.stringify(payments));
                // Surface the partial-split state in the Flow trace Alert
                // so the user sees "partial-split: now=cash 3 / credit 2.25"
                // at a glance.
                push(`partial-split: now=${creditNowMethod} ${creditNowAmount} / credit ${creditDueAmount}`);
                console.log('[Payment] credit partial split, payments=', payments);
              } else {
                push(`credit full: ${total}`);
                payments.push({ amount: total, paymentMethodId, journalId, paymentMode });
                console.log(`💳 Credit payment: Total=${total}`);
              }
            }
            paymentMethodLabel = paymentMethodLabel || method.name || (
              paymentMode === 'card'   ? 'Card'   :
              paymentMode === 'credit' ? 'Credit' :
                                         'Cash'
            );
          }
          payments.forEach((p, idx) => {
            const type = p.amount > 0 ? 'RECEIVED' : 'CHANGE';
            console.log(`[PAYMENT LOG] #${idx + 1} Type: ${type}, Amount: ${p.amount}, JournalId: ${p.journalId}, PaymentMethodId: ${p.paymentMethodId}`);
          });
          const totalPaymentAmount = payments.reduce((sum, p) => sum + p.amount, 0);
          console.log('💰 Total payment amount:', totalPaymentAmount, 'Order total:', total);
          if (roundMoney(totalPaymentAmount) < roundMoney(total)) {
            console.log('⚠️ Payment amount does not cover order total. Skipping submit.');
            Toast.show({
              type: 'error',
              text1: 'Payment Error',
              text2: 'Payment amount does not cover the order total',
              position: 'bottom',
            });
            return;
          }

          // If TakeoutDelivery's Place Order pre-created a draft pos.order,
          // discard it now and re-submit via sync_from_ui. The legacy
          // 4-step manual finalize (createPayment + write amount_paid +
          // action_pos_order_paid) does not reliably create the
          // stock.picking on Odoo 18/19 — that's why on-hand stopped
          // decrementing. sync_from_ui IS the official UI pipeline and
          // always creates the picking, so route every paid order
          // through it whether or not a draft existed.
          // The Place Order pre-create now uses a `DRAFT-<ts>` placeholder
          // name (see createPosOrderOdoo) so Odoo never consumed a real
          // sequence number on the draft. Deleting the draft is safe and
          // the sync_from_ui below allocates the real ref number once.
          if (createdOrderId) {
            push(`delete pre-existing: ${createdOrderId}`);
            console.log('[POSFinalize] discarding pre-existing draft id=', createdOrderId, 'before sync_from_ui');
            const delResp = await deletePosOrderOdoo(createdOrderId);
            if (delResp?.error) {
              push(`delete pre-existing: err ${delResp.error?.message || ''}`);
              console.warn('[POSFinalize] discard draft warning:', delResp.error?.message || delResp.error);
            } else {
              push('delete pre-existing: ok');
            }
            createdOrderId = null;
          }

          {
            // Cashier id comes from the auth store, not route params — older
            // navigate calls didn't reliably pass it, and we don't want this
            // to crash if a future caller forgets. `false` is Odoo's "no
            // user" sentinel, which makes the server fall back to the
            // JSON-RPC session user.
            const authUser = useAuthStore.getState().user;
            const cashierUserId = (authUser && (authUser.id || authUser.uid)) || false;
            const orderUid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const returnLineCount = (products || []).filter((p) => p.isReturnLine).length;
            console.log('[RETURN TAX] paying — withTax:', withTaxMode, '| returnLines:', returnLineCount,
              '| taxAmount:', taxAmount, '| total:', total,
              '| lines:', lines.map((l) => ({ name: l.name, ret: !!l.isReturnLine, rate: l.lockedTaxRate, qty: l.qty })));
            const submitResp = await submitPosOrderToOdoo({
              orderUid,
              sessionId,
              posConfigId: resolvedConfigId,
              userId: cashierUserId,
              partnerId,
              lines: lines.map((l) => {
                const lineSubtotal = (typeof l.price_subtotal !== 'undefined' && l.price_subtotal !== null)
                  ? Number(l.price_subtotal)
                  : Number(l.price) * Number(l.qty) * (1 - (Number(l.discount) || 0) / 100);
                // Resolve the per-line Odoo tax_ids from the cart's product
                // → tax-id map. When the cashier flipped "With Tax" off we
                // ship an empty list so Odoo books zero tax regardless of
                // product.taxes_id; when on, we always pass the explicit ids
                // so we don't rely on Odoo's auto-fill (which doesn't fire
                // reliably on sync_from_ui).
                const pid = Number(l.product_id);
                const taxInfo = productTaxMap[pid];
                // Return lines keep their ORIGINAL tax regardless of the toggle:
                // taxed if the original was taxed (lockedTaxAmount≠0), else none.
                // New lines follow the With Tax toggle.
                const lockedRate = Number(l.lockedTaxRate) || 0;
                const returnHadTax = l.isReturnLine && Math.abs(lockedRate) > 0.0001;
                const taxIdsForLine = l.isReturnLine
                  // Return line → the ORIGINAL tax ids (matches the locked rate),
                  // not the product's current default. Empty if bought untaxed.
                  ? (returnHadTax ? (Array.isArray(l.lockedTaxIds) && l.lockedTaxIds.length ? l.lockedTaxIds : (taxInfo?.taxIds || [])) : [])
                  : (withTaxMode ? (taxInfo?.taxIds || []) : []);
                // Return lines: incl = subtotal × (1 + locked rate) for the
                // current returned qty. New lines: recompute incl when tax is on.
                const priceSubtotalIncl = l.isReturnLine
                  ? lineSubtotal * (1 + lockedRate)
                  : ((withTaxMode && taxInfo?.rate)
                      ? (taxInfo.priceInclude
                          ? lineSubtotal
                          : lineSubtotal * (1 + taxInfo.rate / 100))
                      : lineSubtotal);
                return {
                  product_id: l.product_id,
                  qty: l.qty,
                  price_unit: l.price,
                  price_subtotal: lineSubtotal,
                  price_subtotal_incl: priceSubtotalIncl,
                  discount: l.discount || 0,
                  name: l.name,
                  customer_note: l.customer_note || '',
                  taxIds: taxIdsForLine,
                  // Keep this line's tax_ids even when With Tax is globally off.
                  lockTax: !!l.isReturnLine,
                };
              }),
              payments: payments.map((p) => ({
                amount: p.amount,
                payment_method_id: p.paymentMethodId,
                name: (paymentReference && paymentReference.trim()) || p.paymentMode || 'payment',
              })),
              amountTotal: total,
              amountTax: taxAmount,
              amountPaid: totalPaymentAmount,
              amountReturn: Math.max(0, paidAmount - total),
              toInvoice: invoiceChecked && Boolean(customer && (customer.id || customer._id)),
              companyId,
              withTax: withTaxMode,
            });
            if (submitResp?.error) {
              push(`submit: err ${submitResp.error?.data?.message || submitResp.error?.message || 'unknown'}`);
              console.error('POS submit error:', submitResp.error);
              Toast.show({
                type: 'error',
                text1: 'Could not submit order',
                text2: submitResp.error?.data?.message || submitResp.error?.message || 'Unknown error',
                position: 'bottom',
              });
              return;
            }
            createdOrderId = submitResp.result;
            push(`submit: ok id=${createdOrderId}`);
            console.log('✅ POS Order submitted, id:', createdOrderId);
          }

          {
            // We already have the GPS fix (Strict location gate, top of
            // handlePay) — just persist it on the new pos.order. No
            // background promise, no race, no auto-update on the receipt.
            // Skip the write if the cashier opted to "Save without
            // location" — the order legitimately has no fix to record.
            if (!fix?.skipped && !fix?.error) {
              try {
                await writeOrderLocationOdoo(createdOrderId, fix);
                push('writeLocation: ok');
              } catch (locErr) {
                push(`writeLocation: err ${locErr?.message || locErr}`);
              }
              capturedLocation = {
                latitude: fix.latitude,
                longitude: fix.longitude,
                locationName: fix.locationName,
              };
            } else {
              push('writeLocation: skipped');
              capturedLocation = null;
            }

            // Persist the captured signatures (shop owner + customer) on
            // the new pos.order as ir.attachment. Non-blocking — same
            // tolerance as the location write, so a signature hiccup never
            // loses the completed sale. Only the side(s) actually signed
            // are sent (undefined = unchanged).
            if (signatures.owner || signatures.customer) {
              try {
                const sigResp = await updatePosOrderSignaturesOdoo(createdOrderId, {
                  shop_owner_signature: signatures.owner || undefined,
                  customer_signature: signatures.customer || undefined,
                });
                push(sigResp?.error
                  ? `writeSignatures: err ${sigResp.error?.data?.message || sigResp.error?.message || 'unknown'}`
                  : 'writeSignatures: ok');
              } catch (sigErr) {
                push(`writeSignatures: err ${sigErr?.message || sigErr}`);
              }
            } else {
              push('writeSignatures: skipped');
            }

            // Read Odoo's freshly-allocated POS reference so the receipt
            // shows the real ref (e.g. "Shop/0001") instead of the "/"
            // placeholder Odoo uses before its sequence fires.
            try {
              const refInfo = await fetchPosOrderRefOdoo(createdOrderId);
              if (refInfo?.posReference) posReference = refInfo.posReference;
              push(`fetchRef: ${refInfo?.posReference || 'none'}`);
            } catch (refErr) {
              push(`fetchRef: err ${refErr?.message || refErr}`);
              console.warn('[POS] ref refetch failed:', refErr?.message || refErr);
            }

            // Invoices REQUIRE a partner — Odoo rejects with "partnerId is
            // required" otherwise. So we only invoice when both the
            // checkbox is on AND a customer is attached.
            const shouldCreateInvoice = invoiceChecked && Boolean(customer && (customer.id || customer._id));
              push(`shouldCreateInvoice: ${shouldCreateInvoice} (invoiceChecked=${invoiceChecked}, customer=${customer?.id || customer?._id || 'none'})`);
              console.log('[INVOICE FLOW] shouldCreateInvoice=', shouldCreateInvoice,
                'invoiceChecked=', invoiceChecked,
                'customer=', customer?.id || customer?._id || null);
              // Always create the invoice manually when the cashier wants
              // one. We used to skip this when pos.order.account_move
              // looked truthy after sync_from_ui, but that path proved
              // unreliable — sometimes the linked move never lands in
              // Accounting → Customers → Invoices. createInvoiceOdoo
              // creates an account.move (move_type='out_invoice') and
              // posts it via action_post, which guarantees the row shows
              // up everywhere Odoo's accounting engine surfaces it.
              if (shouldCreateInvoice) {
                try {
                  const actualTotal = Math.round(Number(totalAmount) * 1000) / 1000 || 0;
                  console.log('[INVOICE] Creating invoice for POS order', createdOrderId, 'totalAmount:', actualTotal);

                  const grossTotal = (products || []).reduce((sum, p) => sum + (Number(p.price || p.price_unit || 0) * Number(p.quantity || p.qty || 1)), 0);
                  const ratio = grossTotal > 0 ? actualTotal / grossTotal : 1;

                  const invoiceProducts = (products || []).map((p) => ({
                    // Same remoteId fallback as the POS lines builder above —
                    // Odoo rejects 'prod_<n>' as an integer product_id.
                    id: p.remoteId || p.id,
                    name: p.name || p.product_name || '',
                    quantity: Number(p.quantity || p.qty || 1),
                    price: Math.round(Number(p.price || p.price_unit || 0) * ratio * 1000) / 1000,
                    // Carry the cashier's order note through to the invoice
                    // line — createInvoiceOdoo appends it to the line's
                    // `name` field so Odoo's invoice PDF renders it below
                    // the product name in small text.
                    customer_note: p.customer_note || p.note || '',
                  }));

                  const currentTotal = Math.round(invoiceProducts.reduce((sum, p) => sum + (p.price * p.quantity), 0) * 1000000) / 1000000;
                  const diff = actualTotal - currentTotal;
                  console.log('[INVOICE] currentTotal:', currentTotal, 'actualTotal:', actualTotal, 'diff:', diff);
                  if (Math.abs(diff) > 0.0000001 && invoiceProducts.length > 0) {
                    const last = invoiceProducts[invoiceProducts.length - 1];
                    const adjustedPrice = Math.round((last.price + diff / last.quantity) * 1000000) / 1000000;
                    console.log('[INVOICE] Adjusting last item price from', last.price, 'to', adjustedPrice);
                    last.price = adjustedPrice;
                  }
                  const finalTotal = Math.round(invoiceProducts.reduce((sum, p) => sum + (p.price * p.quantity), 0) * 1000000) / 1000000;
                  console.log('[INVOICE] Final invoice total:', finalTotal, 'Expected:', actualTotal, 'Match:', Math.abs(finalTotal - actualTotal) < 0.0001);

                  const invoiceDate = new Date().toISOString().slice(0, 10);
                  const invResp = await createInvoiceOdoo({ partnerId, products: invoiceProducts, invoiceDate, journalId: selectedJournal?.id || null, withTax: withTaxMode });
                  console.log('[INVOICE] createInvoiceOdoo response:', invResp);
                  const invoiceResult = {
                    id: invResp?.id,
                    number: invResp?.invoiceStatus?.name || invResp?.name,
                    state: invResp?.invoiceStatus?.state,
                    payment_state: invResp?.invoiceStatus?.payment_state,
                    amount_total: invResp?.invoiceStatus?.amount_total,
                    posted: invResp?.invoiceStatus?.state === 'posted',
                  };
                  push(`createInvoice: ${invResp?.id ? `ok id=${invResp.id} state=${invoiceResult.state || 'unknown'}` : 'failed (no id)'}`);
                  console.log('[INVOICE RESULT]', invoiceResult);
                  if (invResp && invResp.id) {
                    const invoiceId = invResp.id;
                    const invoiceNumber = invResp.invoiceStatus?.name || invResp.name || null;
                    invoiceInfo = { id: invoiceId, number: invoiceNumber };

                    try {
                      const linkResp = await linkInvoiceToPosOrderOdoo({ orderId: createdOrderId, invoiceId, setState: true, state: 'invoiced' });
                      push('linkInvoice: ok');
                      console.log('[INVOICE] Linked invoice', invoiceId, 'to POS order', createdOrderId);
                      console.log('[INVOICE FLOW] linkInvoiceToPosOrderOdoo →', linkResp);
                    } catch (linkErr) {
                      push(`linkInvoice: err ${linkErr?.message || linkErr}`);
                      console.warn('[INVOICE] Failed to link invoice to POS order:', linkErr);
                    }

                    try {
                      const totalPaymentAmount2 = (payments || []).reduce((s, p) => s + (p.amount || 0), 0);
                      if (paymentMode === 'credit' && creditNowMethod && creditNowAmount > 0) {
                        // Credit-partial: reconcile ONLY the now (cash/card)
                        // portion against the invoice. The remainder stays
                        // open on the invoice (Amount Due = creditDueAmount)
                        // and posts as receivable via Odoo's customer-account
                        // pos.payment.method side. Use the now-method's bank
                        // journal — selectedJournal is null for credit mode.
                        const nowMethodResolved = creditNowMethod === 'cash' ? cashMethod : cardMethod;
                        const nowJournalId = Array.isArray(nowMethodResolved?.journal_id)
                          ? nowMethodResolved.journal_id[0]
                          : nowMethodResolved?.journal_id;
                        if (nowJournalId) {
                          try {
                            // Use the account.payment.register wizard — it
                            // creates the payment AND reconciles it against
                            // the invoice's receivable line in one shot, so
                            // Amount Due actually drops by creditNowAmount.
                            // Bare account.payment.create (the old helper)
                            // skipped reconcile, leaving the payment as an
                            // orphan Outstanding Credit on the customer.
                            const regResp = await registerPaymentForInvoiceOdoo({
                              invoiceId,
                              amount: creditNowAmount,
                              journalId: nowJournalId,
                              partnerId,
                            });
                            if (regResp?.error) {
                              push(`reconcile now: err ${regResp.error?.message || JSON.stringify(regResp.error)}`);
                            } else {
                              push(`reconcile now: ${creditNowAmount} → invoice ${invoiceId} (residual=${regResp.amount_residual} state=${regResp.payment_state})`);
                            }
                            console.log('[INVOICE PAYMENT] partial-pay register response:', regResp);
                          } catch (payErr) {
                            push(`reconcile now: err ${payErr?.message || payErr}`);
                            console.warn('[INVOICE PAYMENT] partial-pay reconcile failed:', payErr);
                          }
                        } else {
                          push(`reconcile now: skipped (no journal on ${creditNowMethod} method)`);
                        }
                      } else if (paymentMode === 'credit') {
                        // Full credit (no now-portion): no payment to reconcile
                        // against the invoice. Amount Due = full invoice total;
                        // the customer-account pos.payment.method posts it to
                        // the partner's receivable automatically.
                        console.log('[INVOICE PAYMENT] full-credit mode — invoice stays open, receivable handled by pay_later method');
                      } else if (paymentMode === 'split') {
                        // Split — register one account.payment PER LEG so the
                        // invoice's payment widget (and the rendered PDF)
                        // shows both rows: e.g. "Paid on … : 5.000 (Cash)"
                        // + "Paid on … : 0.250 (Mobile Transfer)" instead
                        // of one consolidated cash line. Each leg uses its
                        // own pos.payment.method's journal.
                        console.log('[INVOICE PAYMENT] split reconcile begin', {
                          invoiceId, total, legs: payments.length, partnerId,
                        });
                        for (let i = 0; i < payments.length; i += 1) {
                          const leg = payments[i];
                          const legAmount = Number(leg?.amount) || 0;
                          if (legAmount <= 0) continue;
                          const legJournalId = leg?.journalId || null;
                          if (!legJournalId) {
                            push(`reconcile leg ${i + 1}: skipped — no journal`);
                            console.warn('[INVOICE PAYMENT] split leg skipped — no journal', { i, leg });
                            continue;
                          }
                          try {
                            const regResp = await registerPaymentForInvoiceOdoo({
                              invoiceId, amount: legAmount, journalId: legJournalId, partnerId,
                            });
                            if (regResp?.error) {
                              push(`reconcile leg ${i + 1}: err ${regResp.error?.message || JSON.stringify(regResp.error)}`);
                              console.warn('[INVOICE PAYMENT] split leg error:', regResp.error);
                            } else {
                              push(`reconcile leg ${i + 1}: ${legAmount} (journal ${legJournalId}) → residual=${regResp.amount_residual} state=${regResp.payment_state}`);
                              console.log('[INVOICE PAYMENT] split leg ok:', { i, regResp });
                            }
                          } catch (e) {
                            push(`reconcile leg ${i + 1}: threw ${e?.message || e}`);
                            console.warn('[INVOICE PAYMENT] split leg threw:', e);
                          }
                        }
                      } else {
                        // Cash / Card single-method — the customer already paid
                        // at the till, so register ONE full-amount payment via
                        // the wizard. Journal comes from cashMethod / cardMethod
                        // (NOT `selectedJournal`, which is often null here).
                        const nowMethodResolved = paymentMode === 'card' ? cardMethod : cashMethod;
                        const nowJournalId = Array.isArray(nowMethodResolved?.journal_id)
                          ? nowMethodResolved.journal_id[0]
                          : nowMethodResolved?.journal_id;
                        console.log('[INVOICE PAYMENT] non-credit reconcile begin', {
                          paymentMode, invoiceId, total, nowJournalId, partnerId,
                          methodName: nowMethodResolved?.name || null,
                        });
                        if (nowJournalId) {
                          try {
                            const regResp = await registerPaymentForInvoiceOdoo({
                              invoiceId, amount: total, journalId: nowJournalId, partnerId,
                            });
                            if (regResp?.error) {
                              push(`reconcile full: err ${regResp.error?.message || JSON.stringify(regResp.error)}`);
                              console.warn('[INVOICE PAYMENT] reconcile error:', regResp.error);
                            } else {
                              push(`reconcile full: ${total} → invoice ${invoiceId} (residual=${regResp.amount_residual} state=${regResp.payment_state})`);
                              console.log('[INVOICE PAYMENT] reconcile ok:', regResp);
                            }
                          } catch (e) {
                            push(`reconcile full: threw ${e?.message || e}`);
                            console.warn('[INVOICE PAYMENT] reconcile threw:', e);
                          }
                        } else {
                          push(`reconcile full: skipped — no journal on ${paymentMode} method`);
                          console.warn('[INVOICE PAYMENT] reconcile skipped — no journal on method', {
                            paymentMode,
                            methodId: nowMethodResolved?.id || null,
                            methodName: nowMethodResolved?.name || null,
                          });
                        }
                      }
                    } catch (outerPayErr) {
                      console.warn('[INVOICE PAYMENT] Error checking/creating payment:', outerPayErr);
                    }

                    // Freeze the customer's due onto the order, now that the
                    // invoice is posted, linked and every leg reconciled. This
                    // is the only correct moment: the server reads the invoice
                    // residual, so capturing any earlier would record a
                    // part-paid order as entirely unpaid. Read back later by
                    // the Orders History screen. Idempotent and fail-soft — a
                    // failure here must never affect a completed sale.
                    try {
                      const dueSnap = await captureOrderDueOdoo({ orderId: createdOrderId });
                      push(dueSnap
                        ? `captureDue: prev=${dueSnap.previousDue} this=${dueSnap.thisInvoiceDue} total=${dueSnap.totalDue}`
                        : 'captureDue: unavailable');
                    } catch (dueErr) {
                      push(`captureDue: err ${dueErr?.message || dueErr}`);
                      console.warn('[ORDER DUE] capture failed:', dueErr);
                    }

                  }
                } catch (invErr) {
                  push(`createInvoice: exception ${invErr?.message || invErr}`);
                  console.error('[INVOICE] Exception creating invoice:', invErr);
                  console.log('[INVOICE RESULT]', { error: invErr?.message || String(invErr) });
                }
              }
          }
        } catch (e) {
          push(`INNER CATCH (post-submit): ${e?.message || e}`);
          console.error('Payment API exception:', e);
          Toast.show({ type: 'error', text1: 'Payment Error', text2: e?.message || 'Failed to create payment', position: 'bottom' });
        }
      }

      // Clear the cart now that the order is paid + validated, so the
      // register screen is empty next time the user navigates back. Also
      // clear the persistent draft id from the store — this sale is done,
      // a fresh cart should produce a fresh draft.
      try { clearProducts(); } catch (_) {}
      try { useProductStore.getState().clearDraftOrder(); } catch (_) {}
      // This sale's signatures are saved on the order — clear them so the
      // next sale starts with empty pads.
      setSignatures({ owner: null, customer: null });

      // Tax for the receipt — when the cashier left "With Tax" checked we
      // pass through the same `taxAmount` the totals breakdown above used
      // (computed from productTaxMap × cart). When unchecked, `taxAmount`
      // is already zero, which is also what Odoo will book because the
      // submit ships tax_ids=[] per line.
      push(`navigate: receipt orderId=${createdOrderId}`);
      navigation.navigate('POSReceiptScreen', {
        orderId: createdOrderId,
        products,
        customer,
        amount: paidAmount,
        totalAmount: total,
        // Prefer the locally computed discount; fall back to the
        // route-level value if this screen was opened mid-flow. Ship
        // the effective percent (derived) so the receipt can label
        // the discount line consistently regardless of format.
        discount: computedDiscountAmount || discountAmount,
        discountPercent: effectiveDiscountPercent,
        subtotal,
        tax: taxAmount,
        invoiceChecked,
        invoice: invoiceInfo,
        sessionId,
        registerName,
        // GPS coordinates + place name — captured BEFORE submit and
        // frozen here. Receipt must not refetch or auto-update.
        capturedLocation,
        // Odoo's freshly-allocated POS reference (e.g. "Shop/0001"),
        // already resolved by fetchPosOrderRefOdoo above.
        posReference,
        // Display label for the receipt's payment-method line — seeded
        // here so the preview never flashes "Cash" while waiting for
        // fetchPosOrderPaymentsOdoo to resolve.
        paymentMethodLabel,
        // Captured signatures (base64 PNG) so the receipt prints them
        // immediately without a round-trip back to Odoo. This closure
        // still holds the values even though state was reset above for
        // the next sale (setState doesn't mutate the current closure).
        signatures: { owner: signatures.owner, customer: signatures.customer },
      });
    } catch (e) {
      push(`OUTER CATCH: ${e?.message || e}`);
      Toast.show({ type: 'error', text1: 'POS Error', text2: e?.message || 'Failed to create POS order', position: 'bottom' });
    } finally {
      setPaying(false);
      // Flow trace stays in Metro console (console.log via the push()
      // helper above) — the in-app Alert popup has been removed now
      // that the cash/credit/partial chains are verified working.
    }
  };

  // Mode → display config (kept inside render to access onPress closures cleanly)
  const renderModeCard = (mode, label, icon, onPress) => {
    const active = paymentMode === mode;
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[styles.modeCard, active && styles.modeCardActive]}
      >
        <View style={[styles.modeIconDisk, active && styles.modeIconDiskActive]}>
          <MaterialIcons name={icon} size={22} color={active ? '#fff' : NAVY} />
        </View>
        <Text
          style={[styles.modeLabel, active && styles.modeLabelActive]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderKey = (key) => {
    const isQuickAdd = key.startsWith('+') && key !== '+/-';
    const isAction = key === '⌫' || key === '+/-' || key === '.';
    let style = styles.keyNumber;
    let textStyle = styles.keyNumberText;
    if (isQuickAdd) {
      style = styles.keyQuickAdd;
      textStyle = styles.keyQuickAddText;
    } else if (isAction) {
      style = styles.keyAction;
      textStyle = styles.keyActionText;
    }
    return (
      <TouchableOpacity
        key={key}
        onPress={() => handleKeypad(key)}
        activeOpacity={0.7}
        style={[styles.keyBase, style]}
      >
        <Text style={textStyle}>{key}</Text>
      </TouchableOpacity>
    );
  };

  const amountInsufficient =
    (paymentMode === 'cash' || paymentMode === 'card') &&
    (isRefund ? roundMoney(paidAmount) > roundMoney(total)
              : roundMoney(paidAmount) < roundMoney(total));

  // Credit (Customer Account) needs a customer — applies whether the
  // cashier picked Credit as the single payment mode or as one slot of a
  // split. Used to disable Validate / Split Confirm up front and to drive
  // the red "Customer required for Credit" hint above the keypad.
  const creditSelected = paymentMode === 'credit'
    || (paymentMode === 'split'
        && (splitSlot1.methodKey === 'credit' || splitSlot2.methodKey === 'credit'));
  const creditNeedsCustomer = creditSelected && !customer;
  // Credit-partial derivations — when a "pay now via" method is picked
  // inside Credit mode, the keypad-driven paidAmount is the now portion
  // and the remainder becomes Credit. When no method is picked we treat
  // the whole total as Credit (now = 0, due = total).
  const creditNowAmount = (paymentMode === 'credit' && creditNowMethod) ? paidAmount : 0;
  const creditDueAmount = paymentMode === 'credit'
    ? Math.max(0, total - creditNowAmount)
    : 0;
  const creditDueOverdrawn = !!creditNowMethod && creditNowAmount > total + 0.001;

  // Split-payment validity — both amounts > 0, sum matches the total within
  // 0.01 tolerance, and the two slots reference different chip keys (same
  // method twice is just a single payment, not a split).
  const splitSlot1Amt = parseFloat(splitSlot1.amount) || 0;
  const splitSlot2Amt = parseFloat(splitSlot2.amount) || 0;
  const splitSum = splitSlot1Amt + splitSlot2Amt;
  const splitValid =
    !!splitSlot1.methodKey &&
    !!splitSlot2.methodKey &&
    splitSlot1Amt > 0 &&
    splitSlot2Amt > 0 &&
    Math.abs(splitSum - total) < 0.01 &&
    splitSlot1.methodKey !== splitSlot2.methodKey;

  // Fixed chip list for the Split Payment popup. The Odoo `pos.payment.method`
  // is resolved at submit time inside handlePay (same resolver the normal
  // Cash/Card/Credit buttons use), so these three chips render even on a
  // register that only has Cash configured.
  // Split popup supports cash + card only — Credit is its own
  // standalone mode (full Credit / credit-partial) handled outside the
  // split flow, so we don't expose it as a split-leg method here.
  const SPLIT_CHIPS = [
    { key: 'cash', label: 'Cash', icon: 'payments' },
    { key: 'card', label: 'Card', icon: 'credit-card' },
  ];
  const getChipByKey = (key) => SPLIT_CHIPS.find((c) => c.key === key) || null;

  // Tap handler for the bottom Validate button. Shows a styled popup when the
  // user hasn't entered enough cash, otherwise runs the existing payment flow.
  const onValidateTap = () => {
    if (paying) return;
    // Credit-without-customer takes priority — the cashier picked Credit
    // (single or as a Split slot) but didn't select a customer. Bounce to
    // the customer-required popup before anything else.
    if (creditNeedsCustomer) {
      setCustomerModalVisible(true);
      return;
    }
    if (creditDueOverdrawn) {
      Toast.show({
        type: 'error',
        text1: 'Amount too high',
        text2: 'The "pay now" amount is greater than the order total.',
        position: 'bottom',
      });
      return;
    }
    if (paymentMode === 'split') {
      if (!splitConfirmed || !splitValid) {
        // Reopen the popup so the cashier can finish entering the split.
        setSplitModalVisible(true);
        return;
      }
    } else if (amountInsufficient) {
      setAmountModalVisible(true);
      return;
    }
    if (!customer) {
      setCustomerModalVisible(true);
      return;
    }
    handlePay();
  };

  return (
    <SafeAreaView backgroundColor={NAVY}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      {/* Hero header — flat navy, no gloss/two-tone */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.heroIconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.heroTitle}>Payment</Text>
            {registerName ? <Text style={styles.heroSubtitle} numberOfLines={1}>{registerName}</Text> : null}
          </View>
          {/* Transparent spacer — same width as the back button so the title stays centered */}
          <View style={styles.heroSpacer} />
        </View>

        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>{displayNum(total)}</Text>
        {(computedDiscountAmount > 0 || taxAmount !== 0) ? (
          <View style={styles.totalBreakdown}>
            {/* Every row reserves an 18px chevron slot at its right edge so
                the price texts form a single straight column regardless of
                whether the row is tappable. The Tax row fills the slot with
                a chevron icon; other rows leave it empty. */}
            <View style={styles.totalBreakdownRow}>
              <Text style={styles.totalBreakdownLabel}>Subtotal</Text>
              <Text style={styles.totalBreakdownValue}>{displayNum(subtotal)}</Text>
              <View style={styles.totalBreakdownChevronSlot} />
            </View>
            {computedDiscountAmount > 0 ? (
              <View style={styles.totalBreakdownRow}>
                <Text style={[styles.totalBreakdownLabel, styles.totalBreakdownDiscount]}>
                  Discount {discountFormat === 'amount' ? '(amount)' : `(${discountPercent}%)`}
                </Text>
                <Text style={[styles.totalBreakdownValue, styles.totalBreakdownDiscount]}>−{displayNum(computedDiscountAmount)}</Text>
                <View style={styles.totalBreakdownChevronSlot} />
              </View>
            ) : null}
            {taxAmount !== 0 ? (
              <TouchableOpacity
                onPress={() => setTaxDetailsModalVisible(true)}
                activeOpacity={0.7}
                style={styles.totalBreakdownRow}
              >
                <Text style={styles.totalBreakdownLabel}>
                  {commonTaxRate ? `Tax (${commonTaxRate}%)` : 'Tax'}
                </Text>
                <Text style={styles.totalBreakdownValue}>{displayNum(taxAmount)}</Text>
                <View style={styles.totalBreakdownChevronSlot}>
                  <MaterialIcons name="chevron-right" size={16} color="rgba(255,255,255,0.85)" />
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.surface}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Outstanding balance for the selected customer — sits directly
              under the total so the salesman sees the old due BEFORE picking a
              payment mode. Hidden while loading, with no customer, and when
              they owe nothing, so a settled sale looks exactly as before. */}
          {customer && outstanding.loaded && outstanding.amount > 0 ? (
            <View style={styles.dueCard}>
              <MaterialIcons name="account-balance-wallet" size={18} color="#9A3412" />
              <Text style={styles.dueLabel}>Previous Due</Text>
              <Text style={styles.dueValue}>{displayNum(outstanding.amount)}</Text>
            </View>
          ) : null}

          {/* Payment Mode segmented control */}
          <View style={styles.modeRow}>
            {renderModeCard('cash', 'Cash', 'payments', async () => {
              setPaymentMode('cash');
              setCreditNowMethod(null);
              setInputAmount('');
              const cashJournal = journals.find((j) => j.id === 16) || journals.find((j) => j.type === 'cash') || { id: 16, name: 'Cash', type: 'cash' };
              setSelectedJournal(cashJournal);
              setTimeout(async () => {
                console.log('Cash card selected, journal id:', cashJournal.id);
                try {
                  const response = await axios.post(`${getOdooUrl()}/web/dataset/call_kw`, {
                    jsonrpc: '2.0',
                    method: 'call',
                    params: {
                      model: 'pos.payment.method',
                      method: 'search_read',
                      args: [[['journal_id', '=', cashJournal.id]]],
                      kwargs: { fields: ['id', 'name', 'journal_id', 'is_cash_count', 'receivable_account_id', 'split_transactions'], limit: 10 },
                    },
                  }, { headers: { 'Content-Type': 'application/json' } });
                  const methods = response.data?.result || [];
                  if (methods.length > 0) console.log('Payment method(s) for journal', cashJournal.id, ':', methods);
                  else console.log('No payment method found for journal', cashJournal.id);
                } catch (e) { console.error('Error fetching payment method details:', e); }
              }, 100);
            })}
            {renderModeCard('card', 'Card', 'credit-card', async () => {
              setPaymentMode('card');
              setCreditNowMethod(null);
              setInputAmount('');
              const cardJournal = journals.find((j) => j.id === 6) || journals.find((j) => j.type === 'bank');
              setSelectedJournal(cardJournal);
              setTimeout(async () => {
                if (cardJournal) {
                  console.log('Card payment selected, journal id:', cardJournal.id);
                  await fetchPaymentMethodId(cardJournal.id);
                } else {
                  console.log('Card payment selected, no journal mapped');
                }
              }, 100);
            })}
            {renderModeCard('credit', 'Credit', 'credit-score', () => {
              // Credit is a bank-type pos.payment.method in Odoo. handlePay
              // looks it up by name from the cached posPaymentMethods list,
              // so no journal lookup is needed here.
              setPaymentMode('credit');
              // Entering Credit fresh starts with no "now" method picked —
              // full credit by default. Clear any stale typed amount.
              setCreditNowMethod(null);
              setInputAmount('');
            })}
            {renderModeCard('split', 'Split\nPayment', 'call-split', () => {
              setPaymentMode('split');
              setCreditNowMethod(null);
              setInputAmount('');
              // Default slot 2 amount to (total - slot1) on first open so the
              // common 50/50 case takes one less tap.
              setSplitSlot1((s) => ({ ...s, amount: s.amount || '' }));
              setSplitSlot2((s) => ({ ...s, amount: s.amount || '' }));
              setSplitModalVisible(true);
            })}
          </View>

          {/* Split-payment summary — visible only after the user confirms a
              valid split in the popup. Tapping Edit reopens the popup so the
              cashier can adjust before tapping the orange Validate button. */}
          {paymentMode === 'split' && splitConfirmed ? (
            <View style={styles.splitSummaryCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.splitSummaryLabel}>SPLIT PAYMENT</Text>
                <Text style={styles.splitSummaryValue}>
                  {(() => {
                    const m1 = getChipByKey(splitSlot1.methodKey);
                    const m2 = getChipByKey(splitSlot2.methodKey);
                    const a1 = displayNum(parseFloat(splitSlot1.amount) || 0);
                    const a2 = displayNum(parseFloat(splitSlot2.amount) || 0);
                    return `${m1?.label || 'Method 1'} ${a1} · ${m2?.label || 'Method 2'} ${a2}`;
                  })()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSplitModalVisible(true)}
                activeOpacity={0.85}
                style={styles.splitEditBtn}
              >
                <MaterialIcons name="edit" size={14} color="#fff" />
                <Text style={styles.splitEditText}>Edit</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Credit mode — inline "Pay Now via" Cash/Card chips so the
              cashier can split the now-vs-due portions in one view without
              opening the Split popup. The keypad below feeds the now
              amount; the remainder posts to Credit on the customer's
              receivable account. */}
          {paymentMode === 'credit' ? (
            <View style={styles.inputCard}>
              <Text style={styles.inputModeLabel}>CREDIT (CUSTOMER ACCOUNT)</Text>

              <View style={styles.creditNowRow}>
                <Text style={styles.creditNowLabel}>Pay now via:</Text>
                <TouchableOpacity
                  style={[styles.creditNowChip, creditNowMethod === 'cash' && styles.creditNowChipActive]}
                  onPress={() => {
                    const next = creditNowMethod === 'cash' ? null : 'cash';
                    console.log('[Payment] credit now method →', next);
                    setCreditNowMethod(next);
                    setInputAmount('');
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="payments" size={14} color={creditNowMethod === 'cash' ? '#fff' : NAVY} />
                  <Text style={[styles.creditNowChipText, creditNowMethod === 'cash' && styles.creditNowChipTextActive]}>Cash</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.creditNowChip, creditNowMethod === 'card' && styles.creditNowChipActive]}
                  onPress={() => {
                    const next = creditNowMethod === 'card' ? null : 'card';
                    console.log('[Payment] credit now method →', next);
                    setCreditNowMethod(next);
                    setInputAmount('');
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="credit-card" size={14} color={creditNowMethod === 'card' ? '#fff' : NAVY} />
                  <Text style={[styles.creditNowChipText, creditNowMethod === 'card' && styles.creditNowChipTextActive]}>Card</Text>
                </TouchableOpacity>
              </View>

              {creditNowMethod ? (
                <View style={styles.inputRow}>
                  <Text style={styles.inputAmount}>
                    {inputAmount ? displayNum(paidAmount) : '0'}
                  </Text>
                  {inputAmount ? (
                    <TouchableOpacity onPress={() => setInputAmount('')} style={styles.clearBtn}>
                      <MaterialIcons name="close" size={20} color="#dc2626" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.inputAmount}>{displayNum(total)}</Text>
              )}

              <Text style={[styles.creditDueLine, creditDueOverdrawn && { color: '#b91c1c' }]}>
                {`Credit (due): ${displayNum(creditDueAmount)}`}
                {customer ? `  → ${customer.name || customer.display_name || 'customer'}` : ''}
              </Text>
            </View>
          ) : paymentMode !== 'split' ? (
            <View style={styles.inputCard}>
              <Text style={styles.inputModeLabel}>
                {paymentMode === 'card' ? 'CARD' : 'CASH'}
              </Text>

              <View style={styles.inputRow}>
                <Text style={styles.inputAmount}>
                  {inputAmount ? displayNum(paidAmount) : '0'}
                </Text>
                {inputAmount ? (
                  <TouchableOpacity onPress={() => setInputAmount('')} style={styles.clearBtn}>
                    <MaterialIcons name="close" size={20} color="#dc2626" />
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.statusPillRow}>
                {(isRefund ? remaining < 0 : remaining > 0) ? (
                  <View style={[styles.statusPill, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}>
                    <MaterialIcons name="error-outline" size={14} color="#b91c1c" />
                    <Text style={[styles.statusPillText, { color: '#b91c1c' }]}>
                      Remaining {displayNum(remaining)}
                    </Text>
                  </View>
                ) : (isRefund ? remaining > 0 : remaining < 0) ? (
                  <View style={[styles.statusPill, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}>
                    <MaterialCommunityIcons name="cash-multiple" size={14} color="#15803d" />
                    <Text style={[styles.statusPillText, { color: '#15803d' }]}>
                      Change {displayNum(Math.abs(remaining))}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.statusPill, { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }]}>
                    <MaterialIcons name="check-circle" size={14} color="#1d4ed8" />
                    <Text style={[styles.statusPillText, { color: '#1d4ed8' }]}>Exact amount</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}

          {/* Odoo-style calculator buttons — Customer + Invoice sit directly
              above the keypad. Customer is filled-navy (primary action,
              tapping opens the selector); Invoice is outlined with a small
              checkbox affordance that flips on tap. Mirrors the layout in
              the user's Odoo POS reference screenshot. */}
          {paymentMode !== 'split' ? (
            <View style={styles.calcButtonRow}>
              <TouchableOpacity
                onPress={openCustomerSelector}
                activeOpacity={0.85}
                style={styles.calcCustomerBtn}
              >
                <MaterialIcons name="person" size={18} color="#fff" />
                <View style={styles.calcBtnLabelWrap}>
                  <Text style={styles.calcCustomerLabel}>Customer</Text>
                  {customer ? (
                    <Text style={styles.calcCustomerSubtitle} numberOfLines={1}>
                      {customer.name || customer.display_name || ''}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  if (invoiceChecked) {
                    console.log('[Payment] invoice uncheck attempted — opening warning');
                    setInvoiceUncheckModalVisible(true);
                  } else {
                    console.log('[Payment] invoice re-checked');
                    setInvoiceChecked(true);
                  }
                }}
                activeOpacity={0.85}
                style={[styles.calcInvoiceBtn, invoiceChecked && styles.calcInvoiceBtnActive]}
              >
                <MaterialIcons name="description" size={18} color={NAVY} />
                <Text style={styles.calcInvoiceLabel}>Invoice</Text>
                <View
                  style={[
                    styles.calcInvoiceCheckbox,
                    invoiceChecked && styles.calcInvoiceCheckboxChecked,
                  ]}
                >
                  {invoiceChecked ? <MaterialIcons name="check" size={12} color="#fff" /> : null}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  console.log('[Payment] withTax toggled →', !withTaxMode);
                  setWithTaxMode((v) => !v);
                }}
                activeOpacity={0.85}
                style={[styles.calcInvoiceBtn, withTaxMode && styles.calcInvoiceBtnActive]}
              >
                <MaterialIcons name="receipt-long" size={18} color={NAVY} />
                <Text style={styles.calcInvoiceLabel}>With Tax</Text>
                <View
                  style={[
                    styles.calcInvoiceCheckbox,
                    withTaxMode && styles.calcInvoiceCheckboxChecked,
                  ]}
                >
                  {withTaxMode ? <MaterialIcons name="check" size={12} color="#fff" /> : null}
                </View>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Payment Reference — optional, saved as the payment name (like
              Odoo's Register Payment popup). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, backgroundColor: '#fff' }}>
            <MaterialIcons name="sell" size={16} color={NAVY} />
            <TextInput
              style={{ flex: 1, fontSize: 14, color: '#111827', paddingVertical: 0 }}
              value={paymentReference}
              onChangeText={setPaymentReference}
              placeholder="Payment Reference (optional)"
              placeholderTextColor="#9ca3af"
            />
          </View>

          {/* Inline red hint when Credit (single or split slot) is selected
              but no customer has been picked yet — the cashier sees the
              missing-customer problem before tapping Validate. */}
          {creditNeedsCustomer ? (
            <Text style={styles.creditCustomerHint}>
              <MaterialIcons name="error-outline" size={12} color="#b91c1c" />
              {'  Customer required for Credit'}
            </Text>
          ) : null}

          {/* Keypad — only useful for cash/card. Split mode has its own
              amount inputs inside the popup. */}
          {paymentMode !== 'account' && paymentMode !== 'split' ? (
            <View style={styles.keypadCard}>
              {keypadRows.map((row, i) => (
                <View key={i} style={styles.keyRow}>
                  {row.map((k) => renderKey(k))}
                </View>
              ))}
            </View>
          ) : null}

          {/* ID-proof chip — only relevant when a customer is selected.
              Green ✓ when at least the Front photo is on file, amber
              warning when missing. Tap to open the view modal. */}
          {customer ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIdProofModalVisible(true)}
              style={[
                styles.idProofChip,
                idProof.front
                  ? { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }
                  : { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
              ]}
            >
              <MaterialIcons
                name={idProof.front ? 'verified' : 'badge'}
                size={16}
                color={idProof.front ? '#166534' : '#9A3412'}
              />
              <Text
                style={[
                  styles.idProofChipText,
                  { color: idProof.front ? '#166534' : '#9A3412' },
                ]}
              >
                {!idProof.loaded
                  ? 'Loading ID proof…'
                  : idProof.front
                    ? (idProof.back ? 'ID Proof on file (Front + Back)' : 'ID Proof on file (Front only)')
                    : 'No ID proof — tap to add'}
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={idProof.front ? '#166534' : '#9A3412'} />
            </TouchableOpacity>
          ) : null}

          {/* Signatures — shown on the payment screen between the end of
              the calc and the Validate button. Read-only preview of the
              two captured signatures; tap to re-open the capture popup. */}
          {customer ? (
            <View style={styles.sigSection}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setSigPopupVisible(true)}
                style={styles.sigSectionHeader}
              >
                <MaterialIcons name="gesture" size={16} color={NAVY} />
                <Text style={styles.sigSectionTitle}>Signatures</Text>
                <Text style={styles.sigSectionHint}>
                  {signatures.owner && signatures.customer
                    ? 'Tap to edit'
                    : 'Tap to sign'}
                </Text>
                <MaterialIcons name="chevron-right" size={18} color={NAVY} />
              </TouchableOpacity>
              <SignatureCards
                owner={signatures.owner}
                customer={signatures.customer}
                onChange={setSignature}
                readOnly
              />
            </View>
          ) : null}
        </ScrollView>

        {/* Validate footer — solid orange, always tappable; popup if cash short.
            With Tax toggle moved up into the calc row alongside Customer +
            Invoice; only the Discount chip stays here. */}
        <View style={styles.footer}>
          {!totalIsExternal ? (
            <TouchableOpacity
              style={[styles.discountChip, computedDiscountAmount > 0 && styles.discountChipActive]}
              onPress={() => {
                // Pre-fill the custom-input box with whichever value
                // matches the current format so the cashier can tweak it.
                setCustomDiscountInput(
                  discountFormat === 'amount'
                    ? (discountAmountValue ? String(discountAmountValue) : '')
                    : (discountPercent ? String(discountPercent) : ''),
                );
                setDiscountModalVisible(true);
              }}
              activeOpacity={0.85}
            >
              <MaterialIcons
                name="percent"
                size={16}
                color={computedDiscountAmount > 0 ? '#fff' : NAVY}
              />
              <Text
                style={[
                  styles.discountChipText,
                  computedDiscountAmount > 0 && styles.discountChipTextActive,
                ]}
                numberOfLines={1}
              >
                {computedDiscountAmount <= 0
                  ? 'Apply discount'
                  : discountFormat === 'amount'
                    ? `−${displayNum(computedDiscountAmount)} off`
                    : `${discountPercent}% off  −${displayNum(computedDiscountAmount)}`}
              </Text>
              {computedDiscountAmount > 0 ? (
                <MaterialIcons name="edit" size={14} color="#fff" />
              ) : null}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onValidateTap}
            activeOpacity={0.85}
            style={[styles.validateBtn, (creditNeedsCustomer || creditDueOverdrawn) && styles.validateBtnDisabled]}
          >
            <View style={styles.validateInner}>
              {paying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MaterialIcons
                    name={creditNeedsCustomer ? 'lock-outline' : (creditDueOverdrawn ? 'error-outline' : 'check-circle')}
                    size={20}
                    color="#fff"
                  />
                  <Text style={styles.validateText}>
                    {creditNeedsCustomer
                      ? 'Pick Customer'
                      : creditDueOverdrawn
                        ? 'Amount too high'
                        : 'Validate Payment'}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Amount Required popup — styled like LogoutModal */}
      <Modal
        visible={amountModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setAmountModalVisible(false)}
      >
        <View style={styles.alertBg}>
          <View style={styles.alertCard}>
            <View style={styles.alertIconDisk}>
              <MaterialCommunityIcons name="cash-multiple" size={28} color={ORANGE} />
            </View>
            <Text style={styles.alertTitle}>Amount Required</Text>
            <Text style={styles.alertText}>
              {`Please enter the full ${paymentMode === 'card' ? 'card' : 'cash'} amount. You still need ${displayNum(remaining)} to cover the total.`}
            </Text>
            <TouchableOpacity
              onPress={() => setAmountModalVisible(false)}
              style={styles.alertOkBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.alertOkText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Split (partial) payment popup — two slots, each with a method
          chip pair (Cash / Card) and an amount field. Confirm validates
          that the two amounts sum to the order total. */}
      <Modal
        visible={splitModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setSplitModalVisible(false)}
      >
        <View style={styles.alertBg}>
          <View style={styles.splitCard}>
            <View style={styles.alertIconDisk}>
              <MaterialIcons name="call-split" size={28} color={ORANGE} />
            </View>
            <Text style={styles.alertTitle}>Split Payment</Text>
            <Text style={styles.alertText}>
              {`Total to collect: ${displayNum(total)}`}
            </Text>

            {/* Mirror of the Payment screen's calc-row buttons — Customer
                / Invoice / With Tax — so the cashier can pick a customer,
                toggle the invoice flag, or flip With Tax without dismissing
                the Split popup. All three are bound to the same parent
                state (same setters / openers used elsewhere). */}
            <View style={styles.splitControlsRow}>
              <TouchableOpacity
                style={styles.splitControlBtn}
                activeOpacity={0.85}
                onPress={() => {
                  setSplitModalVisible(false);
                  openCustomerSelector && openCustomerSelector();
                }}
              >
                <MaterialIcons name="person" size={14} color="#1E88E5" />
                <Text style={styles.splitControlText} numberOfLines={1}>
                  {customer ? (customer.name || 'Customer') : 'Select Customer'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.splitControlBtn, invoiceChecked && styles.splitControlBtnActive]}
                activeOpacity={0.85}
                onPress={() => setInvoiceChecked((v) => !v)}
              >
                <MaterialIcons
                  name={invoiceChecked ? 'check-box' : 'check-box-outline-blank'}
                  size={14}
                  color="#1E88E5"
                />
                <Text style={styles.splitControlText}>Invoice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.splitControlBtn, withTaxMode && styles.splitControlBtnActive]}
                activeOpacity={0.85}
                onPress={() => setWithTaxMode((v) => !v)}
              >
                <MaterialIcons name="receipt-long" size={14} color="#1E88E5" />
                <Text style={styles.splitControlText}>{withTaxMode ? 'With Tax' : 'No Tax'}</Text>
              </TouchableOpacity>
            </View>

            {[
              { slot: splitSlot1, setSlot: setSplitSlot1, label: 'Method 1' },
              { slot: splitSlot2, setSlot: setSplitSlot2, label: 'Method 2' },
            ].map(({ slot, setSlot, label }, idx) => (
              <View key={idx} style={styles.splitSlotCard}>
                <Text style={styles.splitSlotLabel}>{label}</Text>
                <View style={styles.splitChipRow}>
                  {SPLIT_CHIPS.map((c) => {
                    const active = slot.methodKey === c.key;
                    return (
                      <TouchableOpacity
                        key={c.key}
                        onPress={() => setSlot((s) => ({ ...s, methodKey: c.key }))}
                        activeOpacity={0.85}
                        style={[
                          styles.splitChip,
                          active && styles.splitChipActive,
                        ]}
                      >
                        <MaterialIcons
                          name={c.icon}
                          size={16}
                          color={active ? '#fff' : NAVY}
                        />
                        <Text
                          style={[
                            styles.splitChipText,
                            active && styles.splitChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {c.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={slot.amount}
                  onChangeText={(t) => setSlot((s) => ({ ...s, amount: t.replace(/[^0-9.]/g, '') }))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#9ca3af"
                  style={styles.splitAmountInput}
                />
                {(() => {
                  const otherAmt = parseFloat(idx === 0 ? splitSlot2.amount : splitSlot1.amount) || 0;
                  const remaining = Math.max(0, total - otherAmt);
                  // Credit slot — surface where the money lands instead of
                  // the generic "Remaining". Red when customer is missing,
                  // green when the receivable will post to the picked partner.
                  if (slot.methodKey === 'credit') {
                    return customer ? (
                      <Text style={[styles.splitRemainingHint, { color: '#15803d' }]}>
                        {`Goes to ${customer.name || customer.display_name || 'customer'}'s account`}
                      </Text>
                    ) : (
                      <Text style={[styles.splitRemainingHint, { color: '#b91c1c' }]}>
                        Pick a customer first
                      </Text>
                    );
                  }
                  return (
                    <Text style={styles.splitRemainingHint}>
                      {`Remaining ${displayNum(remaining)}`}
                    </Text>
                  );
                })()}
              </View>
            ))}

            {/* Inline same-method error — appears the instant both slots
                reference the same chip so the cashier doesn't have to tap
                Confirm to discover the problem. */}
            {splitSlot1.methodKey &&
              splitSlot2.methodKey &&
              splitSlot1.methodKey === splitSlot2.methodKey ? (
              <Text style={styles.splitSameMethodError}>
                Please select two different payment methods
              </Text>
            ) : null}

            {/* Live sum indicator */}
            <View
              style={[
                styles.splitSumPill,
                splitValid
                  ? { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }
                  : { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
              ]}
            >
              <MaterialIcons
                name={splitValid ? 'check-circle' : 'error-outline'}
                size={14}
                color={splitValid ? '#15803d' : '#b91c1c'}
              />
              <Text
                style={[
                  styles.splitSumText,
                  { color: splitValid ? '#15803d' : '#b91c1c' },
                ]}
              >
                {`Entered ${displayNum(splitSum)} / ${displayNum(total)}`}
              </Text>
            </View>

            <View style={styles.splitActionsRow}>
              <TouchableOpacity
                style={styles.customerEnterBtn}
                activeOpacity={0.85}
                onPress={() => {
                  // Cancel: close the popup without flipping the confirmed
                  // flag. If nothing was confirmed yet, also bounce the user
                  // back to cash mode so they aren't stranded with split
                  // selected and no values.
                  setSplitModalVisible(false);
                  if (!splitConfirmed) setPaymentMode('cash');
                }}
              >
                <Text style={styles.customerEnterText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.customerSkipBtn,
                  (!splitValid || creditNeedsCustomer) && { opacity: 0.55 },
                ]}
                activeOpacity={(splitValid && !creditNeedsCustomer) ? 0.85 : 1}
                onPress={() => {
                  if (creditNeedsCustomer) {
                    Toast.show({
                      type: 'error',
                      text1: 'Split Payment',
                      text2: 'Pick a customer before using Credit',
                      position: 'bottom',
                    });
                    return;
                  }
                  if (!splitValid) {
                    let msg = 'Both amounts must be greater than zero';
                    if (!splitSlot1.methodKey || !splitSlot2.methodKey) {
                      msg = 'Pick a payment method for each slot';
                    } else if (splitSlot1.methodKey === splitSlot2.methodKey) {
                      msg = 'Pick two different payment methods';
                    } else if (Math.abs(splitSum - total) >= 0.01) {
                      msg = `Amounts must add up to ${displayNum(total)}`;
                    }
                    Toast.show({
                      type: 'error',
                      text1: 'Split Payment',
                      text2: msg,
                      position: 'bottom',
                    });
                    return;
                  }
                  setSplitConfirmed(true);
                  setSplitModalVisible(false);
                }}
              >
                <Text style={styles.customerSkipText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Customer Required popup — shown when validate is tapped with no customer selected */}
      <Modal
        visible={customerModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setCustomerModalVisible(false)}
      >
        <View style={styles.alertBg}>
          <View style={styles.alertCard}>
            <View style={styles.alertIconDisk}>
              <MaterialIcons name="person-outline" size={28} color={ORANGE} />
            </View>
            <Text style={styles.alertTitle}>Customer Required</Text>
            <Text style={styles.alertText}>
              Please select a customer to validate the payment.
            </Text>
            <View style={styles.customerActionsRow}>
              <TouchableOpacity
                style={[styles.customerEnterBtn, { flex: 1 }]}
                activeOpacity={0.85}
                onPress={() => {
                  setCustomerModalVisible(false);
                  openCustomerSelector();
                }}
              >
                <Text style={styles.customerEnterText}>Enter Customer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Invoice uncheck warning — fires when the cashier taps the Invoice
          button while it's currently checked. Skipping the invoice is a
          tax-reconciliation risk, so confirmation is mandatory. Re-checking
          (false → true) skips this and flips instantly in the handler. */}
      <Modal
        visible={invoiceUncheckModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setInvoiceUncheckModalVisible(false)}
      >
        <View style={styles.alertBg}>
          <View style={styles.alertCard}>
            <View style={[styles.alertIconDisk, { backgroundColor: '#FEE2E2' }]}>
              <MaterialCommunityIcons name="alert-decagram" size={28} color="#b91c1c" />
            </View>
            <Text style={styles.alertTitle}>Skip invoice?</Text>
            <Text style={styles.alertText}>
              Unchecking removes the invoice from this sale. Without it,
              accounting can't reconcile this transaction for tax filing and
              the order won't appear in monthly VAT reports. Are you sure?
            </Text>
            <View style={styles.customerActionsRow}>
              <TouchableOpacity
                style={styles.customerEnterBtn}
                activeOpacity={0.85}
                onPress={() => {
                  console.log('[Payment] invoice keep — warning dismissed');
                  setInvoiceUncheckModalVisible(false);
                }}
              >
                <Text style={styles.customerEnterText}>Keep Invoice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customerSkipBtn, { backgroundColor: '#DC2626' }]}
                activeOpacity={0.85}
                onPress={() => {
                  console.log('[Payment] invoice skipped via warning');
                  setInvoiceChecked(false);
                  setInvoiceUncheckModalVisible(false);
                }}
              >
                <Text style={styles.customerSkipText}>Skip Invoice</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ID Proof view modal — same shape as LogoutModal: slide-up via
          react-native-modal, white card with navy 2px border, navy
          primary buttons in a row. Read-only quick check; tap
          "Open contact" to jump to CustomerInfo for edits. */}
      <RNModal
        isVisible={idProofModalVisible}
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropOpacity={0.7}
        animationInTiming={400}
        animationOutTiming={300}
        backdropTransitionInTiming={400}
        backdropTransitionOutTiming={300}
        onBackButtonPress={() => setIdProofModalVisible(false)}
        onBackdropPress={() => setIdProofModalVisible(false)}
      >
        <View style={styles.idProofPopupContainer}>
          <Text style={styles.idProofPopupTitle}>
            {`ID Proof — ${customer?.name || ''}`}
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: 14 }}>
            <IdProofCards
              front={idProof.front}
              back={idProof.back}
              onChange={() => {}}
              readOnly
            />
          </View>
          <View style={styles.idProofPopupBtnRow}>
            <TouchableOpacity
              style={[styles.idProofPopupBtn, { flex: 1 }]}
              onPress={() => setIdProofModalVisible(false)}
            >
              <Text style={styles.idProofPopupBtnText}>CLOSE</Text>
            </TouchableOpacity>
            {customer?.id ? (
              <TouchableOpacity
                style={[styles.idProofPopupBtn, { flex: 1 }]}
                onPress={() => {
                  setIdProofModalVisible(false);
                  navigation.navigate('CustomerInfo', { partnerId: customer.id, mode: 'edit' });
                }}
              >
                <Text style={styles.idProofPopupBtnText}>OPEN CONTACT</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </RNModal>

      {/* Signature capture popup — rises automatically after a customer is
          selected. Heading shows the customer name; body has the two
          signature pads (Customer + Shop Owner). */}
      <SignatureCapturePopup
        visible={sigPopupVisible}
        customerName={customer?.name}
        owner={signatures.owner}
        customer={signatures.customer}
        onChange={setSignature}
        onClose={() => setSigPopupVisible(false)}
        busy={paying}
      />

      {/* Total-discount popup — preset percentages + custom input + remove */}
      <Modal
        visible={discountModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDiscountModalVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setDiscountModalVisible(false)}
          style={styles.discountOverlay}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.discountCard}>
            <View style={styles.discountHeader}>
              <View style={styles.discountTitleRow}>
                <MaterialIcons name="percent" size={22} color={NAVY} />
                <Text style={styles.discountTitle}>Select Discount</Text>
              </View>
              <TouchableOpacity onPress={() => setDiscountModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={22} color={NAVY} />
              </TouchableOpacity>
            </View>
            <Text style={styles.discountSubtitle}>Subtotal {displayNum(subtotal)}</Text>

            {/* DISCOUNT TYPE — Total / Items */}
            <View style={styles.discountSegmentWrap}>
              <Text style={styles.discountSegmentLabel}>DISCOUNT TYPE</Text>
              <View style={styles.discountSegmentRow}>
                <TouchableOpacity
                  style={[styles.discountSegmentBtn, discountType === 'total' && styles.discountSegmentBtnActive]}
                  onPress={() => setDiscountType('total')}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="shopping-cart" size={16} color={discountType === 'total' ? '#fff' : NAVY} />
                  <Text style={[styles.discountSegmentText, discountType === 'total' && styles.discountSegmentTextActive]}>
                    Total Discount
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.discountSegmentBtn, discountType === 'items' && styles.discountSegmentBtnActive]}
                  onPress={() => setDiscountType('items')}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="format-list-bulleted" size={16} color={discountType === 'items' ? '#fff' : NAVY} />
                  <Text style={[styles.discountSegmentText, discountType === 'items' && styles.discountSegmentTextActive]}>
                    Items Discount
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* DISCOUNT FORMAT — Percentage / Amount */}
            <View style={styles.discountSegmentWrap}>
              <Text style={styles.discountSegmentLabel}>DISCOUNT FORMAT</Text>
              <View style={styles.discountSegmentRow}>
                <TouchableOpacity
                  style={[styles.discountSegmentBtn, discountFormat === 'percentage' && styles.discountSegmentBtnActive]}
                  onPress={() => {
                    setDiscountFormat('percentage');
                    setCustomDiscountInput('');
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="percent" size={16} color={discountFormat === 'percentage' ? '#fff' : NAVY} />
                  <Text style={[styles.discountSegmentText, discountFormat === 'percentage' && styles.discountSegmentTextActive]}>
                    Percentage
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.discountSegmentBtn, discountFormat === 'amount' && styles.discountSegmentBtnActive]}
                  onPress={() => {
                    setDiscountFormat('amount');
                    setCustomDiscountInput('');
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="cash" size={16} color={discountFormat === 'amount' ? '#fff' : NAVY} />
                  <Text style={[styles.discountSegmentText, discountFormat === 'amount' && styles.discountSegmentTextActive]}>
                    Amount
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Preset grid — values switch with format */}
            <View style={styles.discountGrid}>
              {(discountFormat === 'amount' ? [1, 2, 5, 10, 20] : [10, 20, 30, 40, 50]).map((val) => {
                const active = discountFormat === 'amount'
                  ? Number(discountAmountValue) === val
                  : Number(discountPercent) === val;
                return (
                  <TouchableOpacity
                    key={`disc-${discountFormat}-${val}`}
                    style={[styles.discountOption, active && styles.discountOptionActive]}
                    onPress={() => {
                      if (discountFormat === 'amount') {
                        setDiscountAmountValue(val);
                        setDiscountPercent(0);
                      } else {
                        setDiscountPercent(val);
                        setDiscountAmountValue(0);
                      }
                      setCustomDiscountInput('');
                      setDiscountModalVisible(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.discountOptionText, active && styles.discountOptionTextActive]}>
                      {discountFormat === 'amount' ? displayNum(val) : `${val}%`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom input row */}
            <View style={styles.discountCustomRow}>
              <TextInput
                style={styles.discountCustomInput}
                placeholder={discountFormat === 'amount' ? 'Custom amount' : 'Custom %'}
                placeholderTextColor="#9CA3AF"
                keyboardType={discountFormat === 'amount' ? 'decimal-pad' : 'number-pad'}
                value={customDiscountInput}
                onChangeText={(t) => setCustomDiscountInput(t.replace(/[^0-9.]/g, ''))}
                maxLength={8}
              />
              <TouchableOpacity
                style={styles.discountApplyBtn}
                onPress={() => {
                  const raw = parseFloat(customDiscountInput) || 0;
                  if (discountFormat === 'amount') {
                    const val = Math.max(0, Math.round(raw * 1000) / 1000);
                    setDiscountAmountValue(val);
                    setDiscountPercent(0);
                  } else {
                    const val = Math.max(0, Math.min(100, raw));
                    setDiscountPercent(val);
                    setDiscountAmountValue(0);
                  }
                  setDiscountModalVisible(false);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.discountApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>

            {/* Remove — only when something is applied */}
            {computedDiscountAmount > 0 ? (
              <TouchableOpacity
                style={styles.discountRemoveBtn}
                onPress={() => {
                  setDiscountPercent(0);
                  setDiscountAmountValue(0);
                  setCustomDiscountInput('');
                  setDiscountModalVisible(false);
                }}
                activeOpacity={0.85}
              >
                <MaterialIcons name="close" size={16} color="#DC2626" />
                <Text style={styles.discountRemoveText}>Remove discount</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.discountCancelBtn}
              onPress={() => setDiscountModalVisible(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.discountCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Tax Details popup — per-line breakdown shown when the cashier taps
          the Tax row in the totals breakdown. Mirrors the discount modal's
          backdrop-dismiss pattern. */}
      <Modal
        visible={taxDetailsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTaxDetailsModalVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setTaxDetailsModalVisible(false)}
          style={styles.discountOverlay}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.taxModalCard}>
            <View style={styles.discountHeader}>
              <View style={styles.discountTitleRow}>
                <MaterialIcons name="receipt-long" size={22} color={NAVY} />
                <Text style={styles.discountTitle}>Tax Breakdown</Text>
              </View>
              <TouchableOpacity onPress={() => setTaxDetailsModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={22} color={NAVY} />
              </TouchableOpacity>
            </View>
            <Text style={styles.discountSubtitle}>Total tax {displayNum(taxAmount)}</Text>

            <ScrollView style={styles.taxModalScroll} showsVerticalScrollIndicator={false}>
              {(products || []).map((p, idx) => {
                const { info, tax, lineTotal } = computeLineTax(p);
                const code = p.product_code || p.default_code;
                const qty = Number(p.quantity || p.qty || 0);
                const unitPrice = Number(p.price) || 0;
                const hasTax = !!info && !!info.rate;
                const lineTotalDisplay = hasTax ? lineTotal : (unitPrice * qty * (1 - (effectiveDiscountPercent || 0) / 100));
                return (
                  <View
                    key={p.id ?? p.remoteId ?? idx}
                    style={[styles.taxLineCard, !hasTax && styles.taxLineCardMuted]}
                  >
                    <View style={styles.taxLineRowTop}>
                      <Text style={styles.taxLineName} numberOfLines={2}>{p.name || 'Product'}</Text>
                      {code ? <Text style={styles.taxLineCode}>{String(code)}</Text> : null}
                    </View>
                    <View style={styles.taxLineRow}>
                      <Text style={styles.taxLineMeta}>{`${qty} × ${displayNum(unitPrice)}`}</Text>
                      <Text style={styles.taxLineMeta}>{`Line total ${displayNum(lineTotalDisplay)}`}</Text>
                    </View>
                    {hasTax ? (
                      <View style={styles.taxLineRow}>
                        <Text style={styles.taxLineTaxLabel}>
                          {`Tax ${info.rate}%${info.priceInclude ? ' (included)' : ''}`}
                        </Text>
                        <Text style={styles.taxLineTaxValue}>{displayNum(tax)}</Text>
                      </View>
                    ) : (
                      <View style={styles.taxLineRow}>
                        <Text style={styles.taxLineNoTax}>No tax</Text>
                        <Text style={styles.taxLineNoTax}>—</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.taxModalFooter}>
              <View style={styles.taxFooterRow}>
                <Text style={styles.taxFooterLabel}>Subtotal</Text>
                <Text style={styles.taxFooterValue}>{displayNum(subtotal)}</Text>
              </View>
              {computedDiscountAmount > 0 ? (
                <View style={styles.taxFooterRow}>
                  <Text style={styles.taxFooterLabel}>Discount</Text>
                  <Text style={[styles.taxFooterValue, { color: '#DC2626' }]}>−{displayNum(computedDiscountAmount)}</Text>
                </View>
              ) : null}
              <View style={styles.taxFooterRow}>
                <Text style={styles.taxFooterLabel}>Total Tax</Text>
                <Text style={styles.taxFooterValue}>{displayNum(taxAmount)}</Text>
              </View>
              <View style={styles.taxFooterDivider} />
              <View style={styles.taxFooterRow}>
                <Text style={styles.taxFooterGrandLabel}>Grand Total</Text>
                <Text style={styles.taxFooterGrandValue}>{displayNum(total)}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.taxModalCloseBtn}
              onPress={() => setTaxDetailsModalVisible(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.taxModalCloseText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

export default POSPayment;

const ctaShadow = (color) => Platform.select({
  ios: { shadowColor: color, shadowOpacity: 0.32, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 7 },
});

const cardShadow = Platform.select({
  ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 4 },
});

const styles = StyleSheet.create({
  // Hero — compact
  hero: {
    backgroundColor: NAVY,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 38,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  heroIconBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  // Same-size transparent spacer so the title stays centred without showing
  // a tinted empty square on the right.
  heroSpacer: {
    width: 32, height: 32,
    backgroundColor: 'transparent',
  },
  heroTitle: {
    color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.3,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '500',
    marginTop: 1, fontFamily: FONT_FAMILY.urbanistMedium,
  },
  totalLabel: {
    color: 'rgba(255,255,255,0.65)', fontSize: 10,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    letterSpacing: 1, textAlign: 'center', marginBottom: 4,
  },
  totalValue: {
    color: '#fff', fontSize: 30,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center', letterSpacing: 0.4,
  },

  // Surface
  surface: {
    flex: 1,
    backgroundColor: '#f6f7fb',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    marginTop: -22,
  },

  // Payment mode segmented control — smaller cards
  modeRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6,
  },
  modeCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eef0f5',
    ...cardShadow,
  },
  modeCardActive: {
    backgroundColor: NAVY, borderColor: NAVY, ...ctaShadow(NAVY),
  },
  modeIconDisk: {
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: '#eef0f5',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 5,
  },
  modeIconDiskActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  modeLabel: {
    fontSize: 11, color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center', letterSpacing: 0.2,
  },
  modeLabelActive: { color: '#fff' },

  // Input card — tighter
  inputCard: {
    marginHorizontal: 12, marginTop: 6, marginBottom: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    ...cardShadow,
  },
  inputModeLabel: {
    fontSize: 10, color: '#8896ab',
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    letterSpacing: 1, marginBottom: 4, textAlign: 'center',
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  inputAmount: {
    flex: 1,
    fontSize: 26, color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center', letterSpacing: 0.3,
  },
  clearBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  statusPillRow: {
    flexDirection: 'row', justifyContent: 'center', marginTop: 6,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1,
  },
  statusPillText: {
    fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 3,
  },

  // Keypad — compact
  keypadCard: {
    marginHorizontal: 12, marginTop: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8, paddingHorizontal: 8,
    ...cardShadow,
  },
  keyRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  keyBase: {
    flex: 1, aspectRatio: 1.7, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 3,
  },
  keyNumber: {
    backgroundColor: '#f8f9fc', borderWidth: 1, borderColor: '#eef0f5',
  },
  keyNumberText: {
    fontSize: 17, color: NAVY, fontFamily: FONT_FAMILY.urbanistBold,
  },
  keyQuickAdd: {
    backgroundColor: ORANGE,
    ...ctaShadow(ORANGE),
  },
  keyQuickAddText: {
    fontSize: 13, color: '#fff', fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.2,
  },
  keyAction: {
    backgroundColor: '#eef0f5',
  },
  keyActionText: {
    fontSize: 15, color: NAVY, fontFamily: FONT_FAMILY.urbanistBold,
  },

  // Options card — tighter
  optionsCard: {
    marginHorizontal: 12, marginTop: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 2, paddingHorizontal: 12,
    ...cardShadow,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
  },
  optionRowActive: {},
  optionIcon: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: '#eef0f5',
    alignItems: 'center', justifyContent: 'center',
  },
  optionLabel: {
    fontSize: 10, color: '#8896ab',
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  optionValue: {
    fontSize: 12, color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold, marginTop: 1,
  },
  optionDivider: { height: 1, backgroundColor: '#f1f2f6' },

  // Customer option card — colored highlight, matches the cart-screen chip styling
  customerOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
  },
  customerOptionCardEmpty: {
    backgroundColor: '#FFEDD5',
    borderColor: '#F47B20',
    ...Platform.select({
      ios: { shadowColor: '#F47B20', shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
    }),
  },
  customerOptionCardActive: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
    ...Platform.select({
      ios: { shadowColor: '#22c55e', shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
    }),
  },
  customerOptionIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  customerOptionLabel: {
    fontSize: 10,
    fontFamily: FONT_FAMILY.urbanistBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  customerOptionValue: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  customerOptionAction: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8,
  },
  // ID-proof chip — shows under the customer card on POSPayment.
  idProofChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    gap: 8,
  },
  idProofChipText: {
    flex: 1,
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  // Inline signature preview on the payment screen (between the calc and
  // the Validate footer).
  sigSection: {
    marginHorizontal: 14,
    marginTop: 12,
  },
  sigSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sigSectionTitle: {
    fontSize: 13,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  sigSectionHint: {
    flex: 1,
    textAlign: 'right',
    fontSize: 11,
    color: '#8896ab',
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
// ID-proof popup — mirrors LogoutModal (white card, navy 2px border,
// navy primary buttons in a row).
idProofPopupContainer: {
backgroundColor: '#fff',
borderRadius: 10,
borderColor: NAVY,
borderWidth: 2,
paddingVertical: 22,
paddingHorizontal: 12,
alignItems: 'center',
},
idProofPopupTitle: {
marginVertical: 8,
fontSize: 16,
color: NAVY,
fontFamily: FONT_FAMILY.urbanistBold,
textAlign: 'center',
},
idProofPopupBtnRow: {
flexDirection: 'row',
justifyContent: 'space-between',
alignSelf: 'stretch',
marginTop: 18,
gap: 10,
},
idProofPopupBtn: {
backgroundColor: NAVY,
borderRadius: 10,
padding: 15,
justifyContent: 'center',
alignItems: 'center',
},
idProofPopupBtnText: {
color: '#fff',
fontFamily: FONT_FAMILY.urbanistBold,
letterSpacing: 0.4,
},
  toggleTrack: {
    width: 36, height: 20, borderRadius: 10,
    backgroundColor: '#e5e7eb', justifyContent: 'center', paddingHorizontal: 2,
  },
  toggleTrackOn: { backgroundColor: ORANGE },
  toggleThumb: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#fff',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 2 },
    }),
  },
  toggleThumbOn: { transform: [{ translateX: 16 }] },

  // Footer — slimmer
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 12 },
    }),
  },
  validateBtn: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
    ...ctaShadow(ORANGE),
  },
  validateInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // Amount-required alert — same look as the LogoutModal-style close popup
  alertBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 18,
  },
  alertCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 2, borderColor: NAVY,
    paddingVertical: 22, paddingHorizontal: 18,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 14 },
    }),
  },
  alertIconDisk: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff7ed',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  alertTitle: {
    fontSize: 17, fontWeight: '800', color: '#1a1a2e',
    textAlign: 'center', marginBottom: 6,
  },
  alertText: {
    fontSize: 13, color: '#6b7280',
    textAlign: 'center', lineHeight: 18,
    marginBottom: 18, paddingHorizontal: 4,
  },
  alertOkBtn: {
    alignSelf: 'stretch',
    paddingVertical: 14, borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: NAVY, shadowOpacity: 0.32, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 5 },
    }),
  },
  alertOkText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.4 },
  customerActionsRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
  },
  customerEnterBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerEnterText: {
    color: NAVY, fontWeight: '800', fontSize: 13, letterSpacing: 0.3,
  },
  customerSkipBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    ...ctaShadow(ORANGE),
  },
  customerSkipText: {
    color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.4,
  },
  validateText: {
    color: '#fff', fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3, marginLeft: 4,
  },

  // Previous-due banner — same amber "pay attention" treatment as the split
  // summary card below, laid out as one row: icon · label · amount.
  dueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5,
    borderColor: '#FED7AA',
  },
  dueLabel: {
    flex: 1,
    fontSize: 11,
    color: '#9A3412',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
    marginLeft: 8,
  },
  dueValue: {
    fontSize: 15,
    color: '#9A3412',
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  // Split (partial) payment styles ───────────────────────────────────
  splitSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5,
    borderColor: '#FED7AA',
  },
  splitSummaryLabel: {
    fontSize: 11,
    color: '#9A3412',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  splitSummaryValue: {
    fontSize: 14,
    color: '#9A3412',
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  splitEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginLeft: 10,
  },
  splitEditText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 12,
    marginLeft: 4,
    letterSpacing: 0.3,
  },
  splitCard: {
    width: '88%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'stretch',
    borderWidth: 2,
    borderColor: NAVY,
    ...cardShadow,
  },
  // 3-button row inside the Split popup: Customer / Invoice / With Tax.
  // Mirrors the calc-row controls on the main Payment screen so the
  // cashier can change those settings without dismissing the popup.
  splitControlsRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 6,
  },
  splitControlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#F5F8FE',
  },
  splitControlBtnActive: {
    backgroundColor: '#E7F1FD',
    borderColor: '#1E88E5',
  },
  splitControlText: {
    fontSize: 11,
    color: '#1E88E5',
    fontWeight: '700',
  },
  splitSlotCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  splitSlotLabel: {
    fontSize: 11,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  splitChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  splitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: NAVY,
  },
  splitChipActive: {
    backgroundColor: NAVY,
    borderColor: NAVY,
  },
  splitChipText: {
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
    marginLeft: 6,
    letterSpacing: 0.3,
  },
  splitChipTextActive: {
    color: '#fff',
  },
  splitAmountInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 18,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center',
  },
  splitRemainingHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#6b7280',
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    textAlign: 'right',
  },
  splitSumPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  splitSameMethodError: {
    color: '#b91c1c',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: 0.2,
  },
  splitSumText: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginLeft: 6,
    letterSpacing: 0.3,
  },
  splitActionsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  // Subtotal / Discount mini-rows shown under the hero TOTAL when a
  // discount is active. Compact, white-on-navy text against the hero.
  totalBreakdown: {
    marginTop: 8,
    alignSelf: 'center',
    minWidth: '60%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  totalBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  totalBreakdownLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  totalBreakdownValue: {
    color: '#fff',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'right',
    minWidth: 80,
  },
  // Fixed 18px slot to the right of every value so prices vertically
  // align across rows. The Tax row fills it with a chevron icon; other
  // rows leave it empty.
  totalBreakdownChevronSlot: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalBreakdownDiscount: {
    color: '#fde68a',
  },
  // Discount chip in the footer above the Validate button.
  discountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: NAVY,
    backgroundColor: '#fff',
    marginBottom: 10,
    alignSelf: 'stretch',
  },
  discountChipActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  discountChipText: {
    color: NAVY,
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
  },
  discountChipTextActive: {
    color: '#fff',
  },
  // Discount popup — backdrop + centered card, mirrors the LogoutModal
  // / IdProof popup pattern used elsewhere on this screen.
  discountOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  discountCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: NAVY,
    padding: 18,
    width: '100%',
    maxWidth: 420,
  },
  discountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  discountTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  discountTitle: {
    fontSize: 18,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
  },
  discountSubtitle: {
    fontSize: 12,
    color: '#6b7a90',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 14,
  },
  // Segmented-control wrapper — soft grey card with the section label
  // above and the two flex:1 buttons inside.
  discountSegmentWrap: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  discountSegmentLabel: {
    fontSize: 10,
    color: '#6b7a90',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  discountSegmentRow: {
    flexDirection: 'row',
    gap: 6,
  },
  discountSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: NAVY,
    backgroundColor: '#fff',
  },
  discountSegmentBtnActive: {
    backgroundColor: NAVY,
    borderColor: NAVY,
  },
  discountSegmentText: {
    color: NAVY,
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  discountSegmentTextActive: {
    color: '#fff',
  },
  discountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    justifyContent: 'flex-start',
  },
  discountOption: {
    width: '23%',
    paddingVertical: 14,
    backgroundColor: '#f6f8fa',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#eef0f5',
    alignItems: 'center',
  },
  discountOptionActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  discountOptionText: {
    fontSize: 16,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  discountOptionTextActive: {
    color: '#fff',
  },
  discountCustomRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  discountCustomInput: {
    flex: 1,
    borderWidth: 1.2,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  discountApplyBtn: {
    backgroundColor: NAVY,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  discountApplyText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  discountRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
    marginBottom: 8,
  },
  discountRemoveText: {
    color: '#DC2626',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  discountCancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },
  discountCancelText: {
    color: '#374151',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },

  // Tax Details popup — opened by tapping the Tax row in the hero
  // breakdown. Mirrors the discount popup's card shape so the cashier
  // sees a familiar layout, but with a scrollable per-line body.
  taxModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: NAVY,
    padding: 18,
    width: '100%',
    maxWidth: 460,
    maxHeight: '85%',
  },
  taxModalScroll: {
    marginTop: 10,
    maxHeight: 320,
  },
  taxLineCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  taxLineCardMuted: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
    opacity: 0.78,
  },
  taxLineRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  taxLineName: {
    flex: 1,
    color: NAVY,
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  taxLineCode: {
    color: '#6b7280',
    fontSize: 10,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  taxLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  taxLineMeta: {
    color: '#475569',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  taxLineTaxLabel: {
    color: ORANGE,
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  taxLineTaxValue: {
    color: ORANGE,
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  taxLineNoTax: {
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    fontStyle: 'italic',
  },
  taxModalFooter: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  taxFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  taxFooterLabel: {
    color: '#475569',
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  taxFooterValue: {
    color: NAVY,
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  taxFooterDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 6,
  },
  taxFooterGrandLabel: {
    color: NAVY,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  taxFooterGrandValue: {
    color: ORANGE,
    fontSize: 18,
    fontFamily: FONT_FAMILY.urbanistExtraBold,
  },
  taxModalCloseBtn: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: ORANGE,
    ...ctaShadow(ORANGE),
  },
  taxModalCloseText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistExtraBold,
    fontSize: 14,
    letterSpacing: 0.3,
  },

  // Odoo-style calculator buttons — Customer + Invoice row above the keypad.
  // Customer is the primary filled-NAVY button; Invoice is the outlined
  // toggle with a small checkbox affordance, switching to a tinted fill when
  // checked. Matches the reference Odoo POS layout the user shared.
  calcButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  calcCustomerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NAVY,
    backgroundColor: NAVY,
    gap: 6,
    minHeight: 48,
  },
  calcBtnLabelWrap: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  calcCustomerLabel: {
    color: '#fff',
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  calcCustomerSubtitle: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    fontStyle: 'italic',
    marginTop: 1,
  },
  calcInvoiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NAVY,
    backgroundColor: '#fff',
    gap: 8,
    minHeight: 48,
  },
  calcInvoiceBtnActive: {
    backgroundColor: '#EEF0F6',
  },
  calcInvoiceLabel: {
    color: NAVY,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
    flex: 1,
    textAlign: 'left',
    marginLeft: 4,
  },
  calcInvoiceCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: NAVY,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calcInvoiceCheckboxChecked: {
    backgroundColor: NAVY,
  },
  // Credit-partial inline UI — Pay-Now-via chip row + Credit-due line
  // shown inside the Credit input card when paymentMode === 'credit'.
  creditNowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  creditNowLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginRight: 4,
  },
  creditNowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: NAVY,
    backgroundColor: '#fff',
  },
  creditNowChipActive: {
    backgroundColor: NAVY,
  },
  creditNowChipText: {
    color: NAVY,
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  creditNowChipTextActive: {
    color: '#fff',
  },
  creditDueLine: {
    marginTop: 8,
    fontSize: 12,
    color: '#15803d',
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center',
  },

  // Inline red hint when Credit is selected but no customer chosen yet.
  creditCustomerHint: {
    color: '#b91c1c',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  validateBtnDisabled: {
    opacity: 0.55,
  },
});
