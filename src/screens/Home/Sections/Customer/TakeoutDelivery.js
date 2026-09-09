import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, Image, Modal, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { NavigationHeader } from '@components/Header';
import { useProductStore } from '@stores/product';
import { useAuthStore } from '@stores/auth';
import { COLORS } from '@constants/theme';
import { fetchDiscountsOdoo, createPosOrderOdoo } from '@api/services/generalApi';
import { getOdooUrl } from '@api/config/odooConfig';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from '@components/containers';
import { formatCurrency } from '@utils/currency';
import StyledConfirmModal from '@components/Modal/StyledConfirmModal';
import { useFeatureHidden } from '@components/FeatureGate';

// Render a money value with the Odoo-configured company currency.
const displayNum = (n) => formatCurrency(n);

const TakeoutDelivery = ({ navigation, route }) => {
  const cart = useProductStore((s) => s.getCurrentCart()) || [];
  const { addProduct, removeProduct, clearProducts, setProductDiscount, setLineNote } = useProductStore();
  const currency = useAuthStore((s) => s.currency);
  const currencyName = currency?.symbol || currency?.name || '';
  const decimalAccuracy = useAuthStore((s) => s.decimalAccuracy);
  // Privilege gate: when "POS - Edit Line Price" is hidden (OFF) for this
  // user, the cart-line amount is read-only. Default (visible/ON) = editable.
  const priceEditHidden = useFeatureHidden('pos.register.edit_price');
  useEffect(() => {
    console.log('[PRIVILEGE] pos.register.edit_price hidden=', priceEditHidden, '→ price edit', priceEditHidden ? 'LOCKED (read-only)' : 'ALLOWED (tap to edit)');
  }, [priceEditHidden]);
  useEffect(() => { console.log('[CURRENCY:RENDER] TakeoutDelivery name=', currencyName); }, [currencyName]);
  useEffect(() => { console.log('[CURRENCY:RENDER] TakeoutDelivery decimalAccuracy=', decimalAccuracy); }, [decimalAccuracy]);

  // POSRegister's Continue Selling → New Order path passes forceNewOrder=true
  // so this screen always opens with a clean cart, even if a previous
  // session left items in the product store. Defensive secondary clear —
  // the popup handler also calls clearProducts before navigating.
  useEffect(() => {
    if (route?.params?.forceNewOrder) {
      try { clearProducts(); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [creatingOrder, setCreatingOrder] = useState(false);
  // Persistent draft state lives in the product store so it survives
  // screen unmounts (going back to MyOrders → coming back to this screen).
  // The fingerprint is a hash of the cart contents — when the cart
  // changes we treat it as a new sale and create a fresh draft.
  const draftOrderId = useProductStore((s) => s.draftOrderId);
  const draftCartFingerprint = useProductStore((s) => s.draftCartFingerprint);
  const setDraftOrder = useProductStore((s) => s.setDraftOrder);
  // existingOrderId comes from MyOrders draft-resume — tap a draft row
  // and it navigates here with this param. We treat it the same as a
  // just-created draft.
  const existingOrderId = route?.params?.existingOrderId || null;
  // Refund flow (from Return Products): the order already exists, so the CTA is
  // "Payment" (pay out the return), not "Place Order".
  const isRefundFlow = route?.params?.isRefund || false;
  const [discountModalVisible, setDiscountModalVisible] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [customDiscountInput, setCustomDiscountInput] = useState('');
  const [discountPresets, setDiscountPresets] = useState([]);
  const STORAGE_KEY = 'local_discount_presets_v1';
  const [lineDiscountModalVisible, setLineDiscountModalVisible] = useState(false);
  const [selectedLine, setSelectedLine] = useState(null);
  const [manageModalVisible, setManageModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [editingPreset, setEditingPreset] = useState(null);
  const [addName, setAddName] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [customer, setCustomer] = useState(null);
  const [lineDiscountInput, setLineDiscountInput] = useState('');
  // Mockup-style discount popup toggles. Default to "items" (the
  // cashier opened it by tapping a specific row) + "amount" (matches
  // the existing OMR-input UX). Reset to defaults on every close so
  // the next open starts clean.
  const [lineDiscountType, setLineDiscountType] = useState('items');       // 'total' | 'items'
  const [lineDiscountFormat, setLineDiscountFormat] = useState('amount');  // 'percentage' | 'amount'
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  // Per-line note (Odoo pos.order.line.customer_note). Distinct from the
  // order-wide note above — this one is gated on `selectedLine` and mirrors
  // the per-line discount UX.
  const [lineNoteModalVisible, setLineNoteModalVisible] = useState(false);
  const [lineNoteInput, setLineNoteInput] = useState('');
  const lineNoteInputRef = useRef(null);
  const [qtyEditFor, setQtyEditFor] = useState(null);
  const [qtyDraft, setQtyDraft] = useState('');
  const qtyInputRef = useRef(null);
  // Per-line price override — tap the amount to open the "Set Unit Price"
  // popup (mirrors the qty editor). Lets the cashier change the price that
  // otherwise comes fixed from the product's sales price.
  const [priceEditFor, setPriceEditFor] = useState(null);
  const [priceDraft, setPriceDraft] = useState('');
  const priceInputRef = useRef(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const openCustomerSelector = () => {
    navigation.navigate('CustomerScreen', {
      selectMode: true,
      onSelect: (selected) => {
        setCustomer(selected);
      },
    });
  };
  
  // map cart to items with qty and price
  const items = useMemo(() => cart.map(it => {
    const qty = Number(it.quantity ?? it.qty ?? 1);
    const unitPrice = Number(it.price_unit ?? it.price ?? 0);
    // If price_subtotal_incl or price_subtotal exists, use it directly (already includes qty)
    // Otherwise calculate: unit_price * qty
    const subtotal = (typeof it.price_subtotal_incl === 'number') 
      ? it.price_subtotal_incl 
      : (typeof it.price_subtotal === 'number') 
        ? it.price_subtotal 
        : (unitPrice * qty);
    
    return {
      id: String(it.id),
      qty,
      discount_amount: Number(it.discount_amount || 0),
      discount_percent: Number(it.discount_percent || it.discount || 0),
      name: it.name || (it.product_id && it.product_id[1]) || 'Product',
      unit: unitPrice,
      subtotal,
      customer_note: it.customer_note || '',
      rawItem: it
    };
  }), [cart]);

  const total = useMemo(() => items.reduce((s, it) => s + (it.subtotal || (it.unit * it.qty)), 0), [items]);
  const discountApplied = Number(discountAmount) || 0;
  const finalTotal = total - discountApplied;

  // Fingerprint of the current cart — sorted by id then a tuple of
  // (id, qty, price). Used to detect "same cart as the existing draft"
  // so we can reuse the draft instead of creating duplicates.
  const cartFingerprint = useMemo(() => {
    const sig = (cart || [])
      .map((c) => [String(c.remoteId || c.id), Number(c.quantity || c.qty || 0), Number(c.price || 0)])
      .sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(sig);
  }, [cart]);

  // Effective draft id for this screen instance — the route param wins
  // (draft-resume from MyOrders), otherwise we read from the persistent
  // store (set by a previous Save / Place Order with the same cart).
  const activeDraftId = existingOrderId
    || (draftCartFingerprint === cartFingerprint ? draftOrderId : null);

  // Seed the store from existingOrderId on mount so subsequent Save /
  // Confirm taps see it without needing route params.
  useEffect(() => {
    if (existingOrderId && draftOrderId !== existingOrderId) {
      setDraftOrder(existingOrderId, cartFingerprint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingOrderId]);

  // Persisted discount presets: load local first, fallback to Odoo fetch
  React.useEffect(() => {
    let mounted = true;
    const loadLocal = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (mounted && Array.isArray(parsed) && parsed.length > 0) {
            setDiscountPresets(parsed);
            return true;
          }
        }
      } catch (e) {
        console.warn('Failed to read local discount presets', e);
      }
      return false;
    };

    const loadDiscounts = async () => {
      try {
        const hasLocal = await loadLocal();
        if (hasLocal) return; // prefer local-managed presets
        const presets = await fetchDiscountsOdoo();
        if (mounted && Array.isArray(presets) && presets.length > 0) {
          setDiscountPresets(presets);
          try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); } catch(e){/* ignore */}
        }
      } catch (e) {
        console.warn('Failed to load discount presets', e);
      }
    };
    loadDiscounts();
    return () => { mounted = false; };
  }, []);

  const refreshDiscounts = async () => {
    try {
      // Only refresh from Odoo when no local presets exist
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        console.log('Local presets present, skipping remote refresh');
        return;
      }
      const presets = await fetchDiscountsOdoo();
      if (Array.isArray(presets)) {
        setDiscountPresets(presets);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); } catch(e){}
      }
    } catch (e) {
      console.warn('refreshDiscounts failed', e);
    }
  };

  const persistPresets = async (presets) => {
    try {
      setDiscountPresets(presets);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(presets || []));
    } catch (e) {
      console.warn('Failed to persist presets', e);
      setDiscountPresets(presets);
    }
  };

  // A return line carries a NEGATIVE qty (-3 = "give three back"), so the
  // steppers run in reverse on it: `+` returns FEWER units (toward zero) and
  // `−` returns more, down to what was actually sold.
  const isReturnLine = (item) => Number(item?.qty) < 0 || !!item?.rawItem?.isReturnLine;

  // How far a return line may go, i.e. the quantity on the original order.
  // openPayFlowForOrder stamps it on the cart item; fall back to the current
  // qty so an unstamped line simply can't be pushed further.
  const returnFloor = (item) => {
    const stamped = Number(item?.rawItem?.returnMaxQty);
    return Number.isFinite(stamped) ? stamped : Number(item.qty);
  };

  const handleIncrement = (item) => {
    // Stop at -1: reaching 0 used to leave a zero-quantity line sitting in the
    // cart, which would then be submitted as an empty line. Dropping a line is
    // what the trash icon is for.
    const newQty = isReturnLine(item)
      ? Math.min(-1, item.qty + 1)
      : item.qty + 1;
    addProduct({ ...item.rawItem, quantity: newQty, qty: newQty });
  };

  const handleDecrement = (item) => {
    if (isReturnLine(item)) {
      // Previously every negative qty hit the `<= 1` guard below, so `−` wiped
      // the whole line instead of stepping -8 → -9.
      const newQty = Math.max(returnFloor(item), item.qty - 1);
      addProduct({ ...item.rawItem, quantity: newQty, qty: newQty });
      return;
    }
    if (item.qty <= 1) {
      removeProduct(item.id);
    } else {
      const newQty = item.qty - 1;
      addProduct({ ...item.rawItem, quantity: newQty, qty: newQty });
    }
  };

  const openQtyEditor = (item) => {
    setQtyEditFor(item);
    // Show a return as a plain count ("3", not "-3") — the cashier types how
    // many units to return and the sign is reapplied on confirm.
    setQtyDraft(String(isReturnLine(item) ? Math.abs(item.qty) : item.qty));
  };

  const closeQtyEditor = () => {
    setQtyEditFor(null);
    setQtyDraft('');
  };

  const confirmQtyEdit = () => {
    if (!qtyEditFor) return;
    const parsed = parseInt(qtyDraft, 10);
    if (isReturnLine(qtyEditFor)) {
      // The old `Math.max(0, parsed)` turned a -1 return line into +1 — a SALE
      // booked on a refund order — and confirming an untouched "-1" collapsed
      // to 0 and deleted the line. Take the magnitude, cap it at the quantity
      // originally sold, and put the sign back.
      const wanted = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
      const capped = Math.min(wanted, Math.abs(returnFloor(qtyEditFor)));
      if (capped === 0) {
        removeProduct(qtyEditFor.id);
      } else {
        const n = -capped;
        addProduct({ ...qtyEditFor.rawItem, quantity: n, qty: n });
      }
      closeQtyEditor();
      return;
    }
    const n = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    if (n === 0) {
      removeProduct(qtyEditFor.id);
    } else {
      addProduct({ ...qtyEditFor.rawItem, quantity: n, qty: n });
    }
    closeQtyEditor();
  };

  const openPriceEditor = (item) => {
    setPriceEditFor(item);
    const unit = Number(item.price_unit ?? item.unit ?? item.price ?? 0);
    setPriceDraft(String(unit));
  };

  const closePriceEditor = () => {
    setPriceEditFor(null);
    setPriceDraft('');
  };

  const confirmPriceEdit = () => {
    if (!priceEditFor) return;
    const parsed = parseFloat(priceDraft);
    const n = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    // Preserve the current qty — addProduct defaults qty to 1 when omitted,
    // so we pass it through. The store recalcs price_subtotal = n * qty.
    const q = Number(priceEditFor.qty) || 1;
    addProduct({ ...priceEditFor.rawItem, price_unit: n, price: n, quantity: q, qty: q });
    closePriceEditor();
  };

  const enterMultiSelectWith = (item) => {
    setMultiSelectMode(true);
    setSelectedIds(new Set([item.id]));
  };

  const toggleSelected = (item) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  };

  const exitMultiSelect = () => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  };

  const performBulkDelete = () => {
    selectedIds.forEach(id => removeProduct(id));
    exitMultiSelect();
    setBulkConfirmOpen(false);
  };

  const handleNewOrder = () => {
    clearProducts();
    navigation.navigate('POSProducts');
  };

  // Shared create logic — used by both Save and Place Order. Returns the
  // new orderId on success, null on failure (after surfacing a toast).
  const createDraft = async () => {
    const sessionId = route?.params?.sessionId;
    const posConfigId = route?.params?.registerId;
    const partnerId = customer?.id || customer?._id || null;
    const lines = cart.map((item) => ({
      product_id: item.remoteId || item.id,
      qty: item.quantity || item.qty || 1,
      price_unit: item.price_unit || item.price || 0,
      name: item.name || 'Product',
      discount: Number(item.discount_percent || item.discount || 0),
      price_subtotal: typeof item.price_subtotal !== 'undefined' ? Number(item.price_subtotal) : undefined,
      customer_note: item.customer_note || '',
    }));
    console.log('[PlaceOrder] payload partnerId=', partnerId,
      'lines=', lines.length, 'amount_total=', finalTotal,
      'discount=', discountApplied);
    setCreatingOrder(true);
    try {
      const resp = await createPosOrderOdoo({
        partnerId,
        lines,
        sessionId,
        posConfigId,
        discount: discountApplied,
        amount_total: finalTotal,
      });
      console.log('[PlaceOrder] createPosOrderOdoo response:', JSON.stringify(resp));
      if (resp?.error) {
        Toast.show({
          type: 'error',
          text1: 'Order Error',
          text2: resp.error.message || JSON.stringify(resp.error) || 'Failed to create draft',
          position: 'bottom',
        });
        return null;
      }
      const orderId = resp?.result;
      if (!orderId) {
        Toast.show({ type: 'error', text1: 'Order Error', text2: 'No order ID returned', position: 'bottom' });
        return null;
      }
      // Remember it in the store so navigation away + back doesn't
      // re-create. Keyed by the cart fingerprint at create time.
      setDraftOrder(orderId, cartFingerprint);
      return orderId;
    } catch (e) {
      console.error('[PlaceOrder] threw:', e?.message || e);
      Toast.show({ type: 'error', text1: 'Order Error', text2: e?.message || 'Failed to create draft', position: 'bottom' });
      return null;
    } finally {
      setCreatingOrder(false);
    }
  };

  const handlePlaceOrder = async () => {
    console.log('[PlaceOrder] handlePlaceOrder fired, cart=', cart?.length || 0,
      'sessionId=', route?.params?.sessionId, 'posConfigId=', route?.params?.registerId,
      'activeDraftId=', activeDraftId);
    if (!cart || cart.length === 0) {
      Toast.show({ type: 'error', text1: 'Cart Empty', text2: 'Add products before placing order', position: 'bottom' });
      return;
    }

    const sessionId = route?.params?.sessionId;
    const posConfigId = route?.params?.registerId;

    // Already saved this exact cart? Reuse the draft. No new orderId.
    let orderId = activeDraftId;
    if (!orderId) {
      orderId = await createDraft();
      if (!orderId) return;
      Toast.show({ type: 'success', text1: 'Draft saved', text2: `Order #${orderId}`, position: 'bottom' });
    }
    navigation.navigate('POSPayment', {
      orderId,
      sessionId,
      registerId: posConfigId,
      totalAmount: finalTotal,
      products: cart,
      discountAmount: discountApplied,
      customer,
    });
  };


  const renderLine = ({ item }) => {
    const isSelected = selectedLine && String(selectedLine.id) === String(item.id);
    const isChecked = selectedIds.has(item.id);
    // Accept either a fully-formed image url (data:/http) from the
    // template-based fetch, or a raw base64 `image_128` string from legacy
    // callers. RN's Image can't load Odoo's `/web/image?…` directly because
    // the JS request has no session cookie.
    const raw = item.rawItem || {};
    const rawImg = raw.image_url || raw.image || raw.image_url_full || null;
    const raw128 = raw.image_128 || raw.image_256 || null;
    const odooBase = (typeof getOdooUrl === 'function' && getOdooUrl()) || '';
    const imgUrl = rawImg && (rawImg.startsWith('data:') || rawImg.startsWith('http'))
      ? rawImg
      : (rawImg && rawImg.startsWith('/') && odooBase
          ? `${odooBase}${rawImg}`
          : (raw128 ? `data:image/png;base64,${raw128}` : null));
    console.log('[REGISTER:IMG]', {
      name: item.name,
      hasRawImg: !!rawImg,
      rawImgPrefix: rawImg ? String(rawImg).slice(0, 40) : null,
      has128: !!raw128,
      keys: Object.keys(raw),
      resolvedImgUrl: imgUrl ? String(imgUrl).slice(0, 60) : null,
    });
    const initial = (item.name || '?').trim().charAt(0).toUpperCase();
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={() => { if (!multiSelectMode) enterMultiSelectWith(item); }}
        onPress={() => {
          if (multiSelectMode) {
            toggleSelected(item);
          } else {
            setSelectedLine(prev => (prev && String(prev.id) === String(item.id) ? null : item));
          }
        }}
        style={{
          flexDirection: 'column',
          marginHorizontal: 12,
          marginBottom: 10,
          backgroundColor: '#fff',
          borderRadius: 14,
          padding: 10,
          borderWidth: 1,
          borderColor: multiSelectMode
            ? (isChecked ? '#2E294E' : '#eef0f5')
            : (isSelected ? '#2E294E' : '#eef0f5'),
          shadowColor: '#1a1a2e',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 2,
        }}
      >
        {/* Top sub-row: checkbox? + thumbnail + name + qty + subtotal + trash */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {multiSelectMode && (
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              borderWidth: 2,
              borderColor: isChecked ? '#2E294E' : '#c5c9d4',
              backgroundColor: isChecked ? '#2E294E' : 'transparent',
              alignItems: 'center', justifyContent: 'center',
              marginRight: 10,
            }}>
              {isChecked && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
            </View>
          )}
          {/* Thumbnail (image or letter) */}
          <View style={{
            width: 52, height: 52, borderRadius: 12,
            backgroundColor: '#eef0f5',
            alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', marginRight: 12,
          }}>
            {imgUrl ? (
              <Image
                source={{ uri: imgUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#2E294E' }}>{initial}</Text>
            )}
          </View>

          {/* Product name + unit price */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e', textAlign: 'left' }} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={{ fontSize: 11, color: '#8896ab', fontWeight: '600', marginTop: 2, textAlign: 'left' }} numberOfLines={1}>
              {displayNum(item.unit)} each
            </Text>
          </View>

          {/* Qty stepper (hidden in multi-select) */}
          {!multiSelectMode && (
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#f6f7fb', borderRadius: 999,
              marginRight: 10, paddingHorizontal: 2,
            }}>
              <TouchableOpacity onPress={() => handleDecrement(item)} style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#2E294E' }}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openQtyEditor(item)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={{ minWidth: 28, textAlign: 'center', fontWeight: '800', color: '#1a1a2e', fontSize: 13, paddingHorizontal: 4 }}>
                  {item.qty}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleIncrement(item)} style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2E294E' }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#fff' }}>+</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Subtotal — tap to override the unit price (skipped in
              multi-select mode where the row tap toggles selection, and
              when the "POS - Edit Line Price" privilege is hidden for this
              user). The dotted underline hints it's editable. */}
          {(multiSelectMode || priceEditHidden) ? (
            <Text style={{ fontWeight: '900', color: '#1a1a2e', fontSize: 14, minWidth: 56, textAlign: 'right' }}>
              {displayNum(item.subtotal || item.price_subtotal || (item.unit * item.qty))}
            </Text>
          ) : (
            <TouchableOpacity
              onPress={() => openPriceEditor(item)}
              activeOpacity={0.6}
              style={{ minWidth: 56, alignItems: 'flex-end' }}
            >
              <Text style={{ fontWeight: '900', color: '#1a1a2e', fontSize: 14, textAlign: 'right', textDecorationLine: 'underline', textDecorationStyle: 'dotted' }}>
                {displayNum(item.subtotal || item.price_subtotal || (item.unit * item.qty))}
              </Text>
            </TouchableOpacity>
          )}

          {/* Per-row delete (hidden in multi-select) */}
          {!multiSelectMode && (
            <TouchableOpacity
              onPress={() => removeProduct(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginLeft: 8, padding: 4 }}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={20} color="#b91c1c" />
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom section: optional discount/note chips, each on its own row, indented past the thumbnail */}
        {(item.discount_amount > 0 || item.customer_note) ? (
          <View style={{
            flexDirection: 'column',
            marginTop: 4,
            paddingLeft: multiSelectMode ? (52 + 12 + 22 + 10) : (52 + 12),
          }}>
            {(item.discount_amount > 0) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ backgroundColor: '#ffedd5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 10, color: '#9a3412', fontWeight: '700' }}>
                    −{displayNum(item.discount_amount)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setProductDiscount(item.rawItem?.id ?? item.id, 0)}
                  style={{ marginLeft: 6, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6, backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }}
                >
                  <Text style={{ fontSize: 10, color: '#b91c1c', fontWeight: '700' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {item.customer_note ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{ backgroundColor: '#ede9fe', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, maxWidth: 200 }}>
                  <Text numberOfLines={1} style={{ fontSize: 10, color: '#5b21b6', fontWeight: '700', fontStyle: 'italic' }}>
                    📝 {item.customer_note}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setLineNote(item.rawItem?.id ?? item.id, '')}
                  style={{ marginLeft: 6, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6, backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }}
                >
                  <Text style={{ fontSize: 10, color: '#b91c1c', fontWeight: '700' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView backgroundColor={'#f6f7fb'}>
      <NavigationHeader title="Register" onBackPress={() => navigation.goBack()} />
      <View style={{ flex: 1, backgroundColor: '#f6f7fb' }}>
        {multiSelectMode && (
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: '#fff',
            borderBottomWidth: 1,
            borderColor: '#eef0f5',
          }}>
            <TouchableOpacity onPress={exitMultiSelect}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#2E294E' }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e' }}>
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity
              disabled={selectedIds.size === 0}
              onPress={() => setBulkConfirmOpen(true)}
            >
              <Text style={{ fontSize: 14, fontWeight: '800', color: selectedIds.size === 0 ? '#fca5a5' : '#b91c1c' }}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        )}
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          renderItem={renderLine}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
              <View style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: '#eef0f5',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}>
                <MaterialCommunityIcons name="cart-outline" size={48} color="#8896ab" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#2E294E', marginBottom: 6 }}>Cart is empty</Text>
              <Text style={{ fontSize: 13, color: '#8896ab', textAlign: 'center', paddingHorizontal: 32 }}>
                Tap "Add Products" below to start building this order.
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 280 }}
        />

        {/* Bottom action bar */}
        <View style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 14,
          paddingTop: 14,
          paddingBottom: 14,
          backgroundColor: '#fff',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          shadowColor: '#1a1a2e',
          shadowOpacity: 0.08,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        }}>
          {/* Total panel */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#2E294E',
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 14,
            marginBottom: 12,
          }}>
            <View>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Total</Text>
              {discountApplied > 0 ? (
                <Text style={{ fontSize: 11, color: '#fbbf24', marginTop: 2 }}>− Discount {displayNum(discountApplied)}</Text>
              ) : (
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{items.length} {items.length === 1 ? 'item' : 'items'}</Text>
              )}
            </View>
            <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 0.3 }}>{displayNum(finalTotal)}</Text>
          </View>

          {/* Chip row: user / note / customer / line discount / manage */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#eeecf5',
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              marginRight: 8,
              marginBottom: 8,
            }}>
              <MaterialIcons name="person-outline" size={14} color="#6b21a8" style={{ marginRight: 4 }} />
              <Text style={{ fontWeight: '800', color: '#6b21a8', fontSize: 12 }}>{route?.params?.userName || 'Administrator'}</Text>
            </View>
            {selectedLine ? (
              <TouchableOpacity onPress={() => setLineDiscountModalVisible(true)} style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#fef3c7',
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: '#f59e0b',
                marginRight: 8,
                marginBottom: 8,
              }}>
                <MaterialIcons name="local-offer" size={14} color="#92400e" style={{ marginRight: 4 }} />
                <Text style={{ fontWeight: '800', color: '#92400e', fontSize: 12 }}>Discount</Text>
              </TouchableOpacity>
            ) : null}
            {selectedLine ? (
              <TouchableOpacity
                onPress={() => {
                  setLineNoteInput(selectedLine.customer_note || selectedLine.rawItem?.customer_note || '');
                  setLineNoteModalVisible(true);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#ede9fe',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: '#7c3aed',
                  marginRight: 8,
                  marginBottom: 8,
                }}
              >
                <MaterialIcons name="sticky-note-2" size={14} color="#5b21b6" style={{ marginRight: 4 }} />
                <Text style={{ fontWeight: '800', color: '#5b21b6', fontSize: 12 }}>Note</Text>
              </TouchableOpacity>
            ) : null}
            {/* Customer chip — pushed to the far right, colored to stand out, pencil affordance for edit */}
            <TouchableOpacity
              onPress={openCustomerSelector}
              activeOpacity={0.85}
              style={{
                marginLeft: 'auto',
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: customer ? '#dcfce7' : '#FFEDD5',
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                marginBottom: 8,
                borderWidth: 1.5,
                borderColor: customer ? '#22c55e' : '#F47B20',
                shadowColor: customer ? '#22c55e' : '#F47B20',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.18,
                shadowRadius: 4,
                elevation: 2,
                maxWidth: '60%',
              }}
            >
              <MaterialIcons
                name={customer ? 'person-pin' : 'person-add-alt-1'}
                size={15}
                color={customer ? '#166534' : '#9A3412'}
                style={{ marginRight: 5 }}
              />
              <Text
                numberOfLines={1}
                style={{
                  fontWeight: '800',
                  color: customer ? '#166534' : '#9A3412',
                  fontSize: 12,
                  letterSpacing: 0.2,
                  maxWidth: 130,
                }}
              >
                {customer ? customer.name : 'Customer'}
              </Text>
              <View
                style={{
                  marginLeft: 6,
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: customer ? '#22c55e' : '#F47B20',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons
                  name={customer ? 'edit' : 'add'}
                  size={13}
                  color="#fff"
                />
              </View>
            </TouchableOpacity>
          </View>

          {/* Add Products primary CTA (full width) */}
          <TouchableOpacity
            onPress={() => navigation.navigate('POSProducts', { sessionId: route?.params?.sessionId, registerId: route?.params?.registerId })}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#F47B20',
              paddingVertical: 14,
              borderRadius: 14,
              marginBottom: 10,
              shadowColor: '#F47B20',
              shadowOffset: { width: 0, height: 5 },
              shadowOpacity: 0.32,
              shadowRadius: 10,
              elevation: 8,
            }}
          >
            <MaterialIcons name="add-shopping-cart" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={{ fontWeight: '900', color: '#fff', fontSize: 15, letterSpacing: 0.4 }}>Add Products</Text>
          </TouchableOpacity>

          {/* Place Order — full width below Add Products. Persistent
              draft dedup happens inside handlePlaceOrder: same cart →
              reuse existing draft, no new Odoo row. */}
          <TouchableOpacity
            onPress={handlePlaceOrder}
            disabled={creatingOrder}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#10b981',
              paddingVertical: 14,
              borderRadius: 14,
              opacity: creatingOrder ? 0.6 : 1,
              shadowColor: '#10b981',
              shadowOffset: { width: 0, height: 5 },
              shadowOpacity: 0.32,
              shadowRadius: 10,
              elevation: 7,
            }}
          >
            {creatingOrder ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name={isRefundFlow ? 'payments' : 'check-circle'} size={20} color="#fff" style={{ marginRight: 6 }} />
                <Text style={{ fontWeight: '900', fontSize: 16, color: '#fff', letterSpacing: 0.3 }}>{isRefundFlow ? 'Payment' : 'Place Order'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Discount Modal (simple percentage grid) */}
      <Modal visible={discountModalVisible} animationType="slide" transparent={true} onRequestClose={() => setDiscountModalVisible(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }}>
          <View style={{ width: '80%', backgroundColor:'#fff', borderRadius:12, padding:20, alignItems:'center' }}>
            <Text style={{ fontWeight:'800', fontSize:18, marginBottom:10 }}>Select Discount</Text>
            <Text style={{ color:'#666', marginBottom:14 }}>Tap a percentage to apply</Text>

            <View style={{ width:'100%', minHeight:120, justifyContent:'center', alignItems:'center' }}>
              {discountPresets && discountPresets.length > 0 ? (
                <View style={{ width:'100%', flexDirection:'row', flexWrap:'wrap', justifyContent:'space-between' }}>
                  {discountPresets.slice(0,6).map(p => ({ id: p.id, label: p.is_percentage ? `${p.amount}%` : `${Number(p.amount)}`, value: p })).map(btn => (
                    <Pressable key={btn.id} onPress={() => {
                      const p = btn.value;
                      const amt = p.is_percentage ? Number(total * (p.amount || 0) / 100) : Number(p.amount || 0);
                      setDiscountAmount(amt);
                      setDiscountModalVisible(false);
                    }} style={{ width:'30%', aspectRatio:1, marginBottom:12, borderRadius:10, backgroundColor:'#f3f4f6', justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:'#e6e6e6' }}>
                      <Text style={{ fontWeight:'800', fontSize:16 }}>{btn.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={{ alignItems:'center' }}>
                  <Text style={{ color:'#666', marginBottom:12 }}>No discounts defined. Add discounts from Manage.</Text>
                  <TouchableOpacity onPress={() => { setManageModalVisible(true); setDiscountModalVisible(false); }} style={{ paddingVertical:10, paddingHorizontal:16, backgroundColor:'#06b6d4', borderRadius:8 }}>
                    <Text style={{ color:'#fff', fontWeight:'700' }}>Open Manage</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <TouchableOpacity onPress={() => setDiscountModalVisible(false)} style={{ marginTop:8, width:'100%', paddingVertical:12, borderRadius:8, backgroundColor:'#f3f4f6', alignItems:'center' }}>
              <Text style={{ color:'#6b7280', fontWeight:'700' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* Per-line / Total Discount modal — mockup design with Type +
          Format segments and a format-aware preset grid. Items mode
          targets the row the cashier tapped; Total mode distributes
          the chosen amount across every cart line proportionally. */}
      <Modal visible={lineDiscountModalVisible} animationType="slide" transparent={true} onRequestClose={() => {
        setLineDiscountModalVisible(false); setSelectedLine(null); setLineDiscountInput('');
        setLineDiscountType('items'); setLineDiscountFormat('amount');
      }}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }}>
          <View style={{ width:'88%', maxWidth:440, backgroundColor:'#fff', borderRadius:14, padding:18 }}>

            {/* Title row */}
            <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
              <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                <MaterialIcons name="percent" size={20} color="#1a1a2e" />
                <Text style={{ fontWeight:'800', fontSize:18, color:'#1a1a2e', marginLeft:6 }}>Select Discount</Text>
              </View>
              <TouchableOpacity onPress={() => {
                setLineDiscountModalVisible(false); setSelectedLine(null); setLineDiscountInput('');
                setLineDiscountType('items'); setLineDiscountFormat('amount');
              }} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
                <MaterialIcons name="close" size={22} color="#1a1a2e" />
              </TouchableOpacity>
            </View>
            {/* Subtitle adapts to mode */}
            {lineDiscountType === 'items' ? (
              <>
                <Text style={{ fontSize:15, fontWeight:'700', color:'#1a1a2e' }}>
                  {selectedLine ? selectedLine.name : ''}
                </Text>
                <Text style={{ fontSize:12, color:'#6b7a90', marginBottom:14 }}>
                  Price: {displayNum((selectedLine?.unit || 0) * (selectedLine?.qty || 1))}
                </Text>
              </>
            ) : (
              <Text style={{ fontSize:13, color:'#6b7a90', marginBottom:14 }}>
                Cart subtotal: {displayNum(items.reduce((s, it) => s + ((it.price || it.unit || 0) * (it.qty || 1)), 0))}
              </Text>
            )}

            {/* DISCOUNT TYPE segmented control */}
            <View style={{ backgroundColor:'#F3F4F6', borderRadius:10, padding:10, marginBottom:10 }}>
              <Text style={{ fontSize:10, color:'#6b7a90', fontWeight:'800', letterSpacing:0.8, marginBottom:8 }}>DISCOUNT TYPE</Text>
              <View style={{ flexDirection:'row', gap:6 }}>
                <TouchableOpacity
                  onPress={() => { setLineDiscountType('total'); setLineDiscountInput(''); }}
                  style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:4, paddingVertical:10, borderRadius:8, borderWidth:1.2, borderColor:'#1a1a2e', backgroundColor: lineDiscountType === 'total' ? '#1a1a2e' : '#fff' }}>
                  <MaterialIcons name="shopping-cart" size={15} color={lineDiscountType === 'total' ? '#fff' : '#1a1a2e'} />
                  <Text style={{ color: lineDiscountType === 'total' ? '#fff' : '#1a1a2e', fontWeight:'700', fontSize:12 }}>Total Discount</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setLineDiscountType('items'); setLineDiscountInput(''); }}
                  style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:4, paddingVertical:10, borderRadius:8, borderWidth:1.2, borderColor:'#1a1a2e', backgroundColor: lineDiscountType === 'items' ? '#1a1a2e' : '#fff' }}>
                  <MaterialIcons name="format-list-bulleted" size={15} color={lineDiscountType === 'items' ? '#fff' : '#1a1a2e'} />
                  <Text style={{ color: lineDiscountType === 'items' ? '#fff' : '#1a1a2e', fontWeight:'700', fontSize:12 }}>Items Discount</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* DISCOUNT FORMAT segmented control */}
            <View style={{ backgroundColor:'#F3F4F6', borderRadius:10, padding:10, marginBottom:12 }}>
              <Text style={{ fontSize:10, color:'#6b7a90', fontWeight:'800', letterSpacing:0.8, marginBottom:8 }}>DISCOUNT FORMAT</Text>
              <View style={{ flexDirection:'row', gap:6 }}>
                <TouchableOpacity
                  onPress={() => { setLineDiscountFormat('percentage'); setLineDiscountInput(''); }}
                  style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:4, paddingVertical:10, borderRadius:8, borderWidth:1.2, borderColor:'#1a1a2e', backgroundColor: lineDiscountFormat === 'percentage' ? '#1a1a2e' : '#fff' }}>
                  <MaterialIcons name="percent" size={15} color={lineDiscountFormat === 'percentage' ? '#fff' : '#1a1a2e'} />
                  <Text style={{ color: lineDiscountFormat === 'percentage' ? '#fff' : '#1a1a2e', fontWeight:'700', fontSize:12 }}>Percentage</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setLineDiscountFormat('amount'); setLineDiscountInput(''); }}
                  style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:4, paddingVertical:10, borderRadius:8, borderWidth:1.2, borderColor:'#1a1a2e', backgroundColor: lineDiscountFormat === 'amount' ? '#1a1a2e' : '#fff' }}>
                  <MaterialCommunityIcons name="cash" size={15} color={lineDiscountFormat === 'amount' ? '#fff' : '#1a1a2e'} />
                  <Text style={{ color: lineDiscountFormat === 'amount' ? '#fff' : '#1a1a2e', fontWeight:'700', fontSize:12 }}>Amount</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Preset grid — values switch with format */}
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:12 }}>
              {(lineDiscountFormat === 'amount' ? [1, 2, 5, 10, 20] : [10, 20, 30, 40, 50]).map((val) => {
                const active = String(lineDiscountInput) === String(val);
                return (
                  <TouchableOpacity
                    key={`linedisc-${lineDiscountFormat}-${val}`}
                    onPress={() => setLineDiscountInput(String(val))}
                    style={{ width:'30%', paddingVertical:14, alignItems:'center', borderRadius:12, borderWidth:1.5, borderColor: active ? '#16a34a' : '#eef0f5', backgroundColor: active ? '#16a34a' : '#f6f8fa' }}>
                    <Text style={{ fontWeight:'800', fontSize:16, color: active ? '#fff' : '#1a1a2e' }}>
                      {lineDiscountFormat === 'amount' ? displayNum(val) : `${val}%`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom input row */}
            <View style={{ flexDirection:'row', alignItems:'center', borderWidth:2, borderColor:'#f59e0b', borderRadius:10, paddingHorizontal:12, paddingVertical:6, marginBottom:14 }}>
              <TextInput
                placeholder={lineDiscountFormat === 'amount' ? '0.00' : '0'}
                value={lineDiscountInput}
                onChangeText={(t) => setLineDiscountInput(t.replace(/[^0-9.]/g, ''))}
                keyboardType={lineDiscountFormat === 'amount' ? 'decimal-pad' : 'number-pad'}
                style={{ flex:1, fontSize:22, textAlign:'center', padding:6, fontWeight:'700' }}
              />
              <Text style={{ fontSize:16, fontWeight:'800', color:'#666', marginLeft:8 }}>
                {lineDiscountFormat === 'amount' ? currencyName : '%'}
              </Text>
            </View>

            {/* Footer Clear / Cancel / Apply */}
            <View style={{ flexDirection:'row', width:'100%', gap:8 }}>
              <TouchableOpacity
                onPress={() => {
                  if (lineDiscountType === 'items') {
                    if (selectedLine) setProductDiscount(selectedLine.rawItem?.id ?? selectedLine.id, 0);
                  } else {
                    cart.forEach((it) => {
                      const id = it.rawItem?.id ?? it.id;
                      setProductDiscount(id, 0);
                    });
                  }
                  setLineDiscountModalVisible(false); setSelectedLine(null); setLineDiscountInput('');
                  setLineDiscountType('items'); setLineDiscountFormat('amount');
                }}
                style={{ flex:1, paddingVertical:12, borderRadius:8, backgroundColor:'#fee2e2', alignItems:'center' }}>
                <Text style={{ color:'#dc2626', fontWeight:'700' }}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setLineDiscountModalVisible(false); setSelectedLine(null); setLineDiscountInput('');
                  setLineDiscountType('items'); setLineDiscountFormat('amount');
                }}
                style={{ flex:1, paddingVertical:12, borderRadius:8, backgroundColor:'#f3f4f6', alignItems:'center' }}>
                <Text style={{ color:'#6b7280', fontWeight:'700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const raw = parseFloat(lineDiscountInput) || 0;
                  if (lineDiscountType === 'items') {
                    if (!selectedLine) return;
                    const lineGross = (selectedLine.unit || 0) * (selectedLine.qty || 1);
                    const amount = lineDiscountFormat === 'percentage'
                      ? Math.round((lineGross * raw / 100) * 1000) / 1000
                      : Math.round(raw * 1000) / 1000;
                    setProductDiscount(selectedLine.rawItem?.id ?? selectedLine.id, amount);
                  } else {
                    // Total mode: distribute the discount proportionally
                    // across every cart line by its gross.
                    const grossList = cart.map((it) => (Number(it.price || it.price_unit || 0) * Number(it.quantity || it.qty || 1)));
                    const totalGross = grossList.reduce((s, v) => s + v, 0);
                    if (totalGross > 0) {
                      const targetTotalDiscount = lineDiscountFormat === 'percentage'
                        ? Math.round((totalGross * raw / 100) * 1000) / 1000
                        : Math.min(totalGross, Math.round(raw * 1000) / 1000);
                      cart.forEach((it, idx) => {
                        const share = (grossList[idx] / totalGross) * targetTotalDiscount;
                        const id = it.rawItem?.id ?? it.id;
                        setProductDiscount(id, Math.round(share * 1000) / 1000);
                      });
                    }
                  }
                  setLineDiscountModalVisible(false); setSelectedLine(null); setLineDiscountInput('');
                  setLineDiscountType('items'); setLineDiscountFormat('amount');
                }}
                style={{ flex:1, paddingVertical:12, borderRadius:8, backgroundColor:'#f59e0b', alignItems:'center' }}>
                <Text style={{ color:'#fff', fontWeight:'700' }}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Per-line Note Modal — opens from the purple "Note" pill that appears
          alongside the Discount pill when a cart row is selected. Writes
          customer_note onto the line via setLineNote; the saved text shows as
          a chip under the product name. */}
      <Modal
        visible={lineNoteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLineNoteModalVisible(false)}
        onShow={() => {
          // autoFocus races the fade-in and Android drops the showSoftInput
          // call — focus explicitly after the native view is attached.
          setTimeout(() => lineNoteInputRef.current?.focus(), 50);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 }}>
          <View style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e', marginBottom: 4 }}>
              Note — {selectedLine?.name || ''}
            </Text>
            <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>
              Free-text note for this line (e.g. "ripe only", "deliver tomorrow").
            </Text>
            <TextInput
              ref={lineNoteInputRef}
              value={lineNoteInput}
              onChangeText={setLineNoteInput}
              placeholder="Type a note for this product…"
              placeholderTextColor="#9ca3af"
              multiline
              style={{
                backgroundColor: '#f8f9fc',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#e5e7eb',
                padding: 12,
                fontSize: 14,
                color: '#1a1a2e',
                minHeight: 90,
                textAlignVertical: 'top',
                fontWeight: '500',
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
              <TouchableOpacity
                onPress={() => setLineNoteInput('')}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#f3f4f6' }}
              >
                <Text style={{ color: '#374151', fontWeight: '700', fontSize: 13 }}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setLineNoteModalVisible(false)}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#f3f4f6' }}
              >
                <Text style={{ color: '#374151', fontWeight: '700', fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (selectedLine) {
                    setLineNote(selectedLine.rawItem?.id ?? selectedLine.id, lineNoteInput);
                  }
                  setLineNoteModalVisible(false);
                }}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#7c3aed' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Manage Discounts Modal (triggered from footer Manage button) */}

      <Modal visible={manageModalVisible} animationType="slide" transparent={true} onRequestClose={() => setManageModalVisible(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }}>
          <View style={{ width:'90%', backgroundColor:'#fff', borderRadius:8, padding:16 }}>
            <Text style={{ fontWeight:'800', fontSize:18, marginBottom:12 }}>Manage Discounts</Text>
            <TouchableOpacity onPress={() => { setAddModalVisible(true); setManageModalVisible(false); }} style={{ padding:12, borderWidth:1, borderColor:'#eee', borderRadius:8, marginBottom:10 }}>
              <Text style={{ fontWeight:'700' }}>➕ Add Discount</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setEditModalVisible(true); setManageModalVisible(false); }} style={{ padding:12, borderWidth:1, borderColor:'#eee', borderRadius:8, marginBottom:10 }}>
              <Text style={{ fontWeight:'700' }}>✏️ Edit Discount</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setDeleteModalVisible(true); setManageModalVisible(false); }} style={{ padding:12, borderWidth:1, borderColor:'#eee', borderRadius:8, marginBottom:10 }}>
              <Text style={{ fontWeight:'700' }}>🗑️ Delete Discount</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setManageModalVisible(false)} style={{ padding:12, marginTop:8 }}>
              <Text style={{ color:'#6b7280' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Discount Modal (simple percentage only) */}
      <Modal visible={addModalVisible} animationType="slide" transparent={true} onRequestClose={() => setAddModalVisible(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ width:'100%', alignItems:'center' }}
            style={{ width:'100%' }}
          >
          <View style={{ width:'90%', backgroundColor:'#fff', borderRadius:8, padding:16 }}>
            <Text style={{ fontWeight:'800', fontSize:18, marginBottom:12 }}>Add New Discount</Text>
            <Text style={{ fontSize:13, color:'#666', marginBottom:10 }}>Enter discount percentage</Text>
            <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingHorizontal:8, paddingVertical:6, marginBottom:12 }}>
              <TextInput placeholder="15" value={addAmount} onChangeText={(t) => setAddAmount(t.replace(/[^0-9.]/g, ''))} keyboardType="numeric" style={{ flex:1, fontSize:22, textAlign:'center', padding:8 }} />
              <Text style={{ fontSize:20, fontWeight:'800', color:'#10b981', marginLeft:8 }}>%</Text>
            </View>
            <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
              <TouchableOpacity onPress={() => { setAddModalVisible(false); setAddAmount(''); }} style={{ padding:12 }}>
                <Text style={{ color:'#6b7280' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={async () => {
                const amt = parseFloat(addAmount) || 0;
                const name = `${amt}%`;
                const newPreset = { id: `local_${Date.now()}`, name, amount: amt, is_percentage: true };
                const updated = Array.isArray(discountPresets) ? [...discountPresets, newPreset] : [newPreset];
                await persistPresets(updated);
                Toast.show({ type:'success', text1:'Created', text2:`${name} discount added` });
                setAddModalVisible(false);
                setAddAmount('');
              }} style={{ backgroundColor:'#10b981', paddingVertical:12, paddingHorizontal:16, borderRadius:8 }}>
                <Text style={{ color:'#fff', fontWeight:'800' }}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Edit Discount Modal (list then edit) */}
      <Modal visible={editModalVisible} animationType="slide" transparent={true} onRequestClose={() => setEditModalVisible(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ width:'100%', alignItems:'center' }}
            style={{ width:'100%' }}
          >
          <View style={{ width:'90%', backgroundColor:'#fff', borderRadius:8, padding:16, maxHeight:'80%' }}>
            <Text style={{ fontWeight:'800', fontSize:18, marginBottom:12 }}>Edit Discount</Text>
            <FlatList data={discountPresets} keyExtractor={d => String(d.id)} renderItem={({item}) => (
              <TouchableOpacity onPress={() => setEditingPreset(item)} style={{ padding:12, borderBottomWidth:1, borderColor:'#f3f4f6' }}>
                <Text style={{ fontWeight:'700' }}>{item.name} {item.is_percentage ? `(${item.amount}%)` : `(${Number(item.amount)})`}</Text>
              </TouchableOpacity>
            )} />
            {editingPreset ? (
              <View style={{ marginTop:12 }}>
                <Text style={{ marginBottom:8, color:'#444' }}>Edit percentage for <Text style={{ fontWeight:'800' }}>{editingPreset.name}</Text></Text>
                <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingHorizontal:8, paddingVertical:6, marginBottom:12 }}>
                  <TextInput placeholder="15" value={String(editingPreset.amount)} onChangeText={(t) => setEditingPreset(prev => ({...prev, amount: Number(t.replace(/[^0-9.]/g, '')) || 0}))} keyboardType="numeric" style={{ flex:1, fontSize:20, textAlign:'center', padding:8 }} />
                  <Text style={{ fontSize:20, fontWeight:'800', color:'#10b981', marginLeft:8 }}>%</Text>
                </View>
                <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                  <TouchableOpacity onPress={() => { setEditingPreset(null); }} style={{ padding:12 }}>
                    <Text style={{ color:'#6b7280' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={async () => {
                    const vals = { name: `${editingPreset.amount}%`, amount: editingPreset.amount, is_percentage: true };
                    const updated = (Array.isArray(discountPresets) ? discountPresets.map(d => d.id === editingPreset.id ? { ...d, ...vals } : d) : [{ ...editingPreset, ...vals }]);
                    await persistPresets(updated);
                    Toast.show({ type:'success', text1:'Updated' });
                    setEditingPreset(null);
                    setEditModalVisible(false);
                  }} style={{ backgroundColor:'#2563eb', paddingVertical:12, paddingHorizontal:16, borderRadius:8 }}>
                    <Text style={{ color:'#fff', fontWeight:'800' }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Delete Discount Modal */}
      <Modal visible={deleteModalVisible} animationType="slide" transparent={true} onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }}>
          <View style={{ width:'90%', backgroundColor:'#fff', borderRadius:8, padding:16, maxHeight:'80%' }}>
            <Text style={{ fontWeight:'800', fontSize:18, marginBottom:12 }}>Delete Discount</Text>
                <FlatList data={discountPresets} keyExtractor={d => String(d.id)} renderItem={({item}) => (
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:8, borderBottomWidth:1, borderColor:'#f3f4f6' }}>
                <Text>{item.name} {item.is_percentage ? `(${item.amount}%)` : `(${Number(item.amount)})`}</Text>
                <TouchableOpacity onPress={async () => {
                  const updated = (Array.isArray(discountPresets) ? discountPresets.filter(d => d.id !== item.id) : []);
                  await persistPresets(updated);
                  Toast.show({ type:'success', text1:'Deleted' });
                }} style={{ padding:8, backgroundColor:'#f97316', borderRadius:6 }}>
                  <Text style={{ color:'#fff' }}>Delete</Text>
                </TouchableOpacity>
              </View>
            )} />
            <TouchableOpacity onPress={() => setDeleteModalVisible(false)} style={{ padding:12, marginTop:8 }}>
              <Text style={{ color:'#6b7280' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Order Note Modal */}
      <Modal
        visible={noteModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{
            width: '100%', maxWidth: 480,
            backgroundColor: '#fff', borderRadius: 16, padding: 18,
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <MaterialIcons name="edit-note" size={22} color="#2E294E" />
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginLeft: 8 }}>Order Note</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                onPress={() => setNoteModalVisible(false)}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' }}
              >
                <MaterialIcons name="close" size={18} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="e.g. No onions, deliver after 6pm…"
              placeholderTextColor="#9ca3af"
              multiline
              style={{
                minHeight: 110, textAlignVertical: 'top',
                borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
                padding: 12, fontSize: 14, color: '#111827',
                backgroundColor: '#f9fafb', marginBottom: 14,
              }}
            />

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {noteText ? (
                <TouchableOpacity
                  onPress={() => { setNoteText(''); setNoteDraft(''); setNoteModalVisible(false); }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center' }}
                >
                  <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 13 }}>Clear</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => setNoteModalVisible(false)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#f3f4f6', alignItems: 'center' }}
              >
                <Text style={{ color: '#6b7280', fontWeight: '800', fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setNoteText(noteDraft.trim()); setNoteModalVisible(false); }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#2E294E', alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Quantity editor */}
      <Modal
        visible={!!qtyEditFor}
        transparent
        animationType="fade"
        onRequestClose={closeQtyEditor}
        onShow={() => {
          qtyInputRef.current?.focus();
          setTimeout(() => {
            const end = qtyDraft.length;
            qtyInputRef.current?.setNativeProps({ selection: { start: 0, end } });
          }, 50);
        }}
      >
        <Pressable
          onPress={closeQtyEditor}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: '100%',
              backgroundColor: '#fff',
              borderRadius: 10,
              borderColor: '#2E294E',
              borderWidth: 2,
              paddingVertical: 22,
              paddingHorizontal: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#2E294E', marginBottom: 8, textAlign: 'center' }}>
              Set Quantity
            </Text>
            {qtyEditFor ? (
              <Text style={{ fontSize: 13, color: '#8896ab', marginBottom: 12, textAlign: 'center' }} numberOfLines={1}>
                {qtyEditFor.name}
              </Text>
            ) : null}
            <TextInput
              ref={qtyInputRef}
              value={qtyDraft}
              onChangeText={(t) => setQtyDraft(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={confirmQtyEdit}
              style={{
                alignSelf: 'stretch',
                borderWidth: 1,
                borderColor: '#d0ceea',
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                fontSize: 18,
                fontWeight: '800',
                color: '#1a1a2e',
                textAlign: 'center',
                marginBottom: 14,
              }}
            />
            <View style={{ flexDirection: 'row', alignSelf: 'stretch' }}>
              <TouchableOpacity
                onPress={closeQtyEditor}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#f3f4f6', alignItems: 'center', marginRight: 5 }}
              >
                <Text style={{ color: '#6b7280', fontWeight: '800', fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmQtyEdit}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#2E294E', alignItems: 'center', marginLeft: 5 }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Set</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Unit-price editor — mirror of the quantity editor. Tap the line
          amount to open; the field is pre-filled with the current unit
          price and fully selected on show so a single keystroke replaces
          it. Decimal-pad with a single-dot guard. */}
      <Modal
        visible={!!priceEditFor}
        transparent
        animationType="fade"
        onRequestClose={closePriceEditor}
        onShow={() => {
          priceInputRef.current?.focus();
          setTimeout(() => {
            const end = priceDraft.length;
            priceInputRef.current?.setNativeProps({ selection: { start: 0, end } });
          }, 50);
        }}
      >
        <Pressable
          onPress={closePriceEditor}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: '100%',
              backgroundColor: '#fff',
              borderRadius: 10,
              borderColor: '#2E294E',
              borderWidth: 2,
              paddingVertical: 22,
              paddingHorizontal: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#2E294E', marginBottom: 8, textAlign: 'center' }}>
              Set Unit Price
            </Text>
            {priceEditFor ? (
              <Text style={{ fontSize: 13, color: '#8896ab', marginBottom: 12, textAlign: 'center' }} numberOfLines={1}>
                {priceEditFor.name}
              </Text>
            ) : null}
            <TextInput
              ref={priceInputRef}
              value={priceDraft}
              onChangeText={(t) => {
                // Allow digits + a single decimal point.
                let v = t.replace(/[^0-9.]/g, '');
                const firstDot = v.indexOf('.');
                if (firstDot !== -1) {
                  v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
                }
                setPriceDraft(v);
              }}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={confirmPriceEdit}
              style={{
                alignSelf: 'stretch',
                borderWidth: 1,
                borderColor: '#d0ceea',
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                fontSize: 18,
                fontWeight: '800',
                color: '#1a1a2e',
                textAlign: 'center',
                marginBottom: 14,
              }}
            />
            <View style={{ flexDirection: 'row', alignSelf: 'stretch' }}>
              <TouchableOpacity
                onPress={closePriceEditor}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#f3f4f6', alignItems: 'center', marginRight: 5 }}
              >
                <Text style={{ color: '#6b7280', fontWeight: '800', fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmPriceEdit}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#2E294E', alignItems: 'center', marginLeft: 5 }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Set</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <StyledConfirmModal
        isVisible={bulkConfirmOpen}
        title={`Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'item' : 'items'}?`}
        message="This will remove the selected lines from the cart."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={performBulkDelete}
        onCancel={() => setBulkConfirmOpen(false)}
      />
    </SafeAreaView>
  );
};

export default TakeoutDelivery;
