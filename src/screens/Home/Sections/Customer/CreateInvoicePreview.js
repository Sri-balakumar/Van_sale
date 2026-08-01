import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, StatusBar, BackHandler, ActivityIndicator, Modal, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import { useProductStore } from '@stores/product';
import { useAuthStore } from '@stores/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { fetchPosOrderPaymentsOdoo, fetchPosOrderDetailOdoo, fetchPosOrderSignaturesOdoo, resolveInvoiceHtml, fetchAppPaperSize, fetchPartnerOutstandingOdoo } from '@api/services/generalApi';
import { getOdooUrl } from '@api/config/odooConfig';
import { generateInvoiceHtml, extractOrderRef, printPageSize } from '@utils/invoiceHtml';
import { formatCurrency } from '@utils/currency';
import Toast from 'react-native-toast-message';
import LocationModal from '@components/Modal/LocationModal';
import PaperSizeModal from '@components/Modal/PaperSizeModal';

const NAVY = '#2E294E';
const ORANGE = '#F47B20';

// Render a money value with the Odoo-configured company currency.
const displayNum = (n) => formatCurrency(n);

const CreateInvoicePreview = ({ navigation, route }) => {
  const params = route?.params || {};
  const { clearProducts } = useProductStore();
  // Subscribe so the screen re-renders when the currency hydrates / changes.
  useAuthStore((s) => s.currency);
  // Company letterhead (res.company): used for the receipt header instead
  // of the old hardcoded "Multaqa Al-Hadhara…" strings. Cached at login.
  const companyProfile = useAuthStore((s) => s.companyProfile);
  // The currently logged-in Odoo user — used for the "Cashier: …" line on
  // the receipt. Falls back to login/uid if .name is missing for some reason.
  const authUser = useAuthStore((s) => s.user);
  const cashierName = authUser?.name || authUser?.username || authUser?.login || 'Cashier';
  useEffect(() => {
    console.log('[INVOICE:PREVIEW] companyProfile snapshot =', companyProfile);
  }, [companyProfile]);
  // Pull the freshest company letterhead from Odoo every time the screen
  // gains focus so an admin edit reflects without a logout.
  useFocusEffect(useCallback(() => {
    try { useAuthStore.getState().refreshCompanyProfile?.(); } catch (_) {}
    try { useAuthStore.getState().refreshUserProfile?.(); } catch (_) {}
  }, []));
  useEffect(() => {
    console.log('[INVOICE:USER] cashier source =', {
      name: authUser?.name,
      username: authUser?.username,
      login: authUser?.login,
      uid: authUser?.uid,
    });
  }, [authUser?.uid]);

  // Action states for the receipt-action buttons
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Linked Accounting invoice id (account.move) — populated from the
  // pos.order.account_move field when this order was credit-finalized.
  // Drives visibility of the "Download PDF (Credit)" chip.
  const [linkedInvoiceId, setLinkedInvoiceId] = useState(null);
  const [linkedInvoiceName, setLinkedInvoiceName] = useState('');
  const [downloadingCredit, setDownloadingCredit] = useState(false);
  // Tappable Location button + popup with Open-in-Maps link
  // (popup is the shared <LocationModal> so the past-order detail and
  // this screen render the same UI).
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  // Paper-size picker — populated when the cashier taps a Preview /
  // Download / Print chip. Holds the *pending action* until the picker
  // resolves to a width in mm; then the matching `runX(mm)` fires.
  const [sizePicker, setSizePicker] = useState(null);
  // Default receipt-size config from Invoice Settings (pos.invoice.settings via
  // RPC). When enabled, the action chips skip the picker and use `mm` directly.
  // Re-read on focus so an admin change in Invoice Settings takes effect.
  const [paperCfg, setPaperCfg] = useState({ enabled: false, mm: null, heightMm: 0 });
  useFocusEffect(useCallback(() => {
    let alive = true;
    fetchAppPaperSize().then((cfg) => {
      if (!alive) return;
      console.log('[PAPER SIZE] CreateInvoicePreview loaded config =', cfg);
      setPaperCfg(cfg);
    });
    return () => { alive = false; };
  }, []));

  // Itemised pos.payment records pulled from Odoo for this order. When the
  // order was paid via the partial-payment popup this returns 2+ entries
  // (e.g. Cash 500, Card 500); for a single-method order it returns one
  // entry. Empty array while the request is in flight.
  const [payments, setPayments] = useState([]);

  // Captured signatures (base64 PNG) for the receipt footer. Seeded from
  // the POSPayment route params (in hand right after the sale) so they
  // print without a round-trip; the async load below back-fills them from
  // Odoo when this screen is opened cold (e.g. re-export from MyOrders).
  const [signatures, setSignatures] = useState({
    owner: params.signatures?.owner || null,
    customer: params.signatures?.customer || null,
  });

  // The Odoo `pos.order.name` (e.g. "Clothes Shop - 000004"). Fetched right
  // after navigation so the receipt prints the per-register sequence number
  // Odoo shows the cashier — not the cumulative database id, which would
  // bump up by every other shop's order too.
  const [orderName, setOrderName] = useState('');

  // Customer Due block on the printed receipt. `invoiceResolved` gates the
  // balance fetch until we know whether this order has a linked invoice —
  // that invoice is already posted by now, so fetching before we can exclude
  // it would count this order's own amount twice against "This Invoice".
  const [invoiceResolved, setInvoiceResolved] = useState(false);
  const [due, setDue] = useState(null);

  // Done = wipe the in-memory cart and reset navigation to the Home tab.
  // Used both by the explicit "Done" button and the back-arrow in the hero.
  const onDone = () => {
    try { clearProducts(); } catch (_) {}
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'AppNavigator' }] })
    );
  };

  // Hardware / gesture back → run the same Done flow instead of letting the
  // navigator pop back to the Payment screen.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onDone();
        return true; // we handled it — stop the default pop
      });
      return () => sub.remove();
    }, [])
  );
  const customer = params.customer || params.partner || params.partnerInfo || null;
  // Support multiple shapes used across the app
  const rawItems = params.items || params.products || [];
  const items = Array.isArray(rawItems) ? rawItems.map((it) => {
    const qty = Number(it.qty ?? it.quantity ?? it.quantity_available ?? 1);
    const price = Number(it.price ?? it.unit ?? it.price_unit ?? it.list_price ?? 0);
    const grossTotal = price * qty;
    const discountAmount = Number(it.discount_amount || 0) || (grossTotal * Number(it.discount_percent ?? it.discount ?? 0) / 100);
    const discountPercent = grossTotal > 0 ? (discountAmount / grossTotal) * 100 : 0;
    const netTotal = grossTotal - discountAmount;
    return {
      id: it.id ?? it.remoteId ?? it.product_id ?? null,
      name: it.name ?? it.product_name ?? it.product?.name ?? 'Product',
      qty,
      price,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      subtotal: typeof it.subtotal !== 'undefined' ? Number(it.subtotal) : netTotal,
      // Preserve the cashier's order note so it can render below the
      // product name in the paper preview (and gets shipped into
      // generateInvoiceHtml below for the printed receipt).
      customer_note: it.customer_note || it.note || '',
    };
  }) : [];

  const subtotal = typeof params.subtotal !== 'undefined' ? Number(params.subtotal) : (typeof params.totalAmount !== 'undefined' ? Number(params.totalAmount) : items.reduce((s, it) => s + (it.subtotal || 0), 0));
  const service = typeof params.service !== 'undefined' ? Number(params.service) : 0;
  const discount = typeof params.discount !== 'undefined' ? Number(params.discount) : 0;
  // Tax row — only shown when the upstream payment screen had "With Tax"
  // checked (or, for re-export from MyOrders, when the saved order has a
  // non-zero amount_tax). Zero hides the row entirely on the printed
  // receipt and in the on-screen preview below.
  const tax = typeof params.tax !== 'undefined' ? Number(params.tax) : 0;
  const total = typeof params.total !== 'undefined' ? Number(params.total) : subtotal + service - discount + tax;
  const orderId = params.orderId || params.id || params.invoiceId || null;
  // Payment method label, seeded from POSPayment so the receipt renders
  // the right method on first paint instead of flashing "Cash" while the
  // async fetchPosOrderPaymentsOdoo settles. Falls back to "Cash" only
  // when the screen is opened without a route-param seed (e.g. from
  // MyOrders), in which case the async load below replaces it.
  const seededPaymentMethodLabel = params.paymentMethodLabel || '';
  // GPS + place name. POSPayment's strict location gate captures the fix
  // BEFORE Validate Payment, so by the time this screen mounts the param
  // is already populated. We render it as-is — no auto-refetch, no retry,
  // no background promise — so the value the cashier saw at payment time
  // is the value that prints on the receipt.
  const capturedLocation = params.capturedLocation || null;

  const grandTotal = total;
  const totalQty = items.reduce((sum, item) => sum + (item.qty || 0), 0);
  const paidAmount = typeof params.amount !== 'undefined' ? Number(params.amount) : (typeof params.paid !== 'undefined' ? Number(params.paid) : (typeof params.paymentAmount !== 'undefined' ? Number(params.paymentAmount) : 0));
  const cashDisplay = paidAmount > 0 ? paidAmount : grandTotal;
  const changeAmount = paidAmount > grandTotal ? (paidAmount - grandTotal) : 0;

  // Per-register sequence number for the receipt (e.g. "000004"). Falls back
  // to the database id padded to 6 digits while the order name is still
  // loading.
  const orderNumber = extractOrderRef(orderName, orderId || '000002');
  const dateStr = new Date().toLocaleDateString('en-GB');
  const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Pull every pos.payment record attached to this order (so the receipt can
  // itemise split payments) AND the order's display name (so the printed
  // ref matches what Odoo shows in its Orders list). Best-effort — failures
  // just fall back to the legacy Cash + Change rendering and a padded id.
  useEffect(() => {
    let alive = true;
    // No order id → there is no linked invoice to exclude from the customer's
    // balance, so let the due fetch proceed immediately rather than stall.
    if (!orderId) { setInvoiceResolved(true); return; }
    Promise.all([
      fetchPosOrderPaymentsOdoo(orderId),
      fetchPosOrderDetailOdoo(orderId),
      fetchPosOrderSignaturesOdoo(orderId),
    ])
      .then(([rows, orderRes, sigRes]) => {
        if (!alive) return;
        setPayments(Array.isArray(rows) ? rows : []);
        // Back-fill any signature side we weren't handed via route params
        // (cold open from MyOrders, or a refresh). Don't clobber an
        // in-hand param value with a null fetch.
        if (sigRes) {
          setSignatures((prev) => ({
            owner: prev.owner || sigRes.shop_owner_signature || null,
            customer: prev.customer || sigRes.customer_signature || null,
          }));
        }
        if (orderRes && !orderRes.error && orderRes.name) {
          setOrderName(orderRes.name);
        }
        // Linked accounting invoice — account_move is [id, "INV/..."]
        // when set, false otherwise. The "Download PDF (Credit)" button
        // only appears when this is populated.
        const am = orderRes?.account_move;
        if (Array.isArray(am) && am[0]) {
          setLinkedInvoiceId(Number(am[0]));
          setLinkedInvoiceName(String(am[1] || `Invoice-${am[0]}`));
          setInvoiceResolved(true);
        } else {
          // Fallback — when linkInvoiceToPosOrderOdoo's write didn't
          // land (or for older orders predating the link fix), Odoo
          // still stamps `invoice_origin` on the move with this pos
          // order's name. Search by that so the Credit PDF button
          // still appears for credit-finalized orders.
          (async () => {
            try {
              const baseUrl = getOdooUrl();
              const refName = orderRes?.name || orderRes?.pos_reference;
              if (!refName || refName === '/') return;
              const resp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
                jsonrpc: '2.0', method: 'call',
                params: {
                  model: 'account.move',
                  method: 'search_read',
                  args: [[['invoice_origin', '=', refName], ['move_type', 'in', ['out_invoice', 'out_refund']]]],
                  kwargs: { fields: ['id', 'name'], limit: 1 },
                },
              }, { headers: { 'Content-Type': 'application/json' } });
              const inv = resp.data?.result?.[0];
              if (inv?.id) {
                setLinkedInvoiceId(Number(inv.id));
                setLinkedInvoiceName(String(inv.name || `Invoice-${inv.id}`));
                console.log('[Receipt] linked invoice via invoice_origin fallback:', inv);
              }
            } catch (e) {
              console.warn('[Receipt] invoice_origin fallback error:', e?.message || e);
            } finally {
              if (alive) setInvoiceResolved(true);
            }
          })();
        }
      })
      .catch(() => { setInvoiceResolved(true); /* keep defaults for fallback */ });
    return () => { alive = false; };
  }, [orderId]);

  // Customer's outstanding balance for the receipt's Customer Due block.
  // Only used when the app renders its own receipt — when pos_dynamic_invoice
  // is enabled the server computes the same three figures itself and
  // resolveInvoiceHtml ignores everything passed here.
  const partnerId = customer?.id || customer?._id || null;
  const thisInvoiceDue = Math.max(0, grandTotal - paidAmount);
  useEffect(() => {
    let alive = true;
    if (!partnerId || !invoiceResolved) return undefined;
    fetchPartnerOutstandingOdoo({
      partnerId,
      excludeMoveId: linkedInvoiceId,
      thisInvoiceDue,
    })
      .then((res) => { if (alive) setDue(res); })
      .catch(() => { if (alive) setDue(null); });
    return () => { alive = false; };
  }, [partnerId, invoiceResolved, linkedInvoiceId, thisInvoiceDue]);

  const isSplit = payments.length > 1;

  // Download the linked Accounting → Invoicing PDF for this pos.order.
  // Used by the "Download PDF (Credit)" chip — appears between Preview
  // and Download when the order has account_move populated (credit
  // flow). Mirrors InvoiceDetailScreen's onPreviewPdf: fetches with
  // session cookie, tries multiple report names, then prompts the user
  // for a save location (Android SAF / iOS share sheet).
  const onDownloadCreditPdf = async () => {
    if (!linkedInvoiceId) return;
    const base = getOdooUrl();
    if (!base) {
      Toast.show({ type: 'error', text1: 'Odoo URL not set', position: 'bottom' });
      return;
    }
    setDownloadingCredit(true);
    const safeName = `${(linkedInvoiceName || `Invoice-${linkedInvoiceId}`).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    const cachePath = `${FileSystem.cacheDirectory}${safeName}`;
    const REPORT_NAMES = [
      'account.report_invoice_with_payments',
      'account.account_invoices',
      'account.report_invoice',
    ];
    try {
      const sessionId = await AsyncStorage.getItem('odoo_session_id');
      const headers = sessionId ? { Cookie: `session_id=${sessionId}` } : {};
      let dl = null;
      for (const reportName of REPORT_NAMES) {
        const url = `${base}/report/pdf/${reportName}/${linkedInvoiceId}`;
        try {
          const attempt = await FileSystem.downloadAsync(url, cachePath, { headers });
          if (!attempt?.uri) continue;
          const info = await FileSystem.getInfoAsync(attempt.uri);
          if (info.exists && (info.size || 0) >= 1000) {
            console.log('[CreditPDF] downloaded via', reportName, 'size=', info.size);
            dl = attempt;
            break;
          }
        } catch (_) { /* try next */ }
      }
      if (!dl?.uri) {
        Toast.show({ type: 'error', text1: 'PDF empty', text2: 'Try again or re-login', position: 'bottom' });
        return;
      }
      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) {
          Toast.show({ type: 'info', text1: 'Save cancelled', position: 'bottom' });
          return;
        }
        const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: FileSystem.EncodingType.Base64 });
        const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri, safeName, 'application/pdf'
        );
        await FileSystem.writeAsStringAsync(targetUri, b64, { encoding: FileSystem.EncodingType.Base64 });
        Toast.show({ type: 'success', text1: 'Saved', text2: safeName, position: 'bottom' });
      } else {
        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
          Toast.show({ type: 'error', text1: 'Sharing not available', position: 'bottom' });
          return;
        }
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: safeName, UTI: 'com.adobe.pdf' });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Download failed', text2: e?.message || 'Unable to download', position: 'bottom' });
    } finally {
      setDownloadingCredit(false);
    }
  };

  // 1. Print Preview — show the receipt HTML in an in-app WebView modal.
  const runPreview = async (paperWidthMm, paperHeightMm = 0) => {
    try {
      const html = await resolveInvoiceHtml({ items, subtotal, service, total, discount, tax, orderId, orderName, paidAmount, customer, payments, paperWidthMm, paperHeightMm, companyProfile, cashierName, shopOwnerSignature: signatures.owner, customerSignature: signatures.customer, previousDue: due?.previousDue || 0, thisInvoiceDue: due?.thisInvoiceDue || 0, totalDue: due?.totalDue || 0 });
      setPreviewHtml(html);
      setPreviewVisible(true);
    } catch (err) {
      console.error('[Receipt] preview error', err);
      Toast.show({ type: 'error', text1: 'Preview failed', text2: err?.message || 'Unable to render preview', position: 'bottom' });
    }
  };

  // 2. Download PDF — render to a temporary file, then prompt the cashier for
  // a save location. On Android we open the Storage Access Framework folder
  // picker so the file lands wherever the user chooses (Downloads, Drive,
  // Documents, etc.). On iOS we fall back to the share sheet, whose
  // "Save to Files" entry is the iOS-equivalent of a folder picker.
  const runDownload = async (paperWidthMm, paperHeightMm = 0) => {
    setDownloading(true);
    try {
      const filename = `Invoice-${orderNumber}.pdf`;
      console.log(`[Download] start — order=${orderId} size=${paperWidthMm}mm`);
      const html = await resolveInvoiceHtml({ items, subtotal, service, total, discount, tax, orderId, orderName, paidAmount, customer, payments, paperWidthMm, paperHeightMm, companyProfile, cashierName, shopOwnerSignature: signatures.owner, customerSignature: signatures.customer, previousDue: due?.previousDue || 0, thisInvoiceDue: due?.thisInvoiceDue || 0, totalDue: due?.totalDue || 0 });
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
          Toast.show({
            type: 'error',
            text1: 'Save failed',
            text2: 'Sharing is not available on this device',
            position: 'bottom',
          });
        }
      }
    } catch (err) {
      console.error('[Receipt] download error', err);
      Toast.show({ type: 'error', text1: 'Download failed', text2: err?.message || 'Unable to generate PDF', position: 'bottom' });
    } finally {
      setDownloading(false);
    }
  };

  // 3. Print Receipt — open the OS print dialog so the user can pick any
  // already-paired printer (AirPrint on iOS, Android print services).
  const runPrint = async (paperWidthMm, paperHeightMm = 0) => {
    setPrinting(true);
    try {
      const html = await resolveInvoiceHtml({ items, subtotal, service, total, discount, tax, orderId, orderName, paidAmount, customer, payments, paperWidthMm, paperHeightMm, companyProfile, cashierName, shopOwnerSignature: signatures.owner, customerSignature: signatures.customer, previousDue: due?.previousDue || 0, thisInvoiceDue: due?.thisInvoiceDue || 0, totalDue: due?.totalDue || 0 });
      // Exact page size (points) so the printer prints at 100% with no scaling.
      await Print.printAsync({ html, ...printPageSize(paperWidthMm, paperHeightMm) });
    } catch (err) {
      // User cancellation throws — only toast for genuine errors
      if (err?.message && !/cancel/i.test(err.message)) {
        console.error('[Receipt] print error', err);
        Toast.show({ type: 'error', text1: 'Print failed', text2: err?.message, position: 'bottom' });
      }
    } finally {
      setPrinting(false);
    }
  };

  // Entry point for the three action chips. When a default size is configured
  // we run the action immediately; otherwise we open the size picker (which
  // then dispatches to the same runX via `sizePicker`).
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NAVY }} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      {/* Hero header — flat navy, no gloss/two-tone */}
      <View style={s.hero}>
        <View style={s.heroTop}>
          <TouchableOpacity
            onPress={onDone}
            style={s.heroIconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.heroTitle}>Invoice</Text>
          <View style={s.heroSpacer} />
        </View>

        <View style={s.successDisk}>
          <MaterialIcons name="check" size={36} color="#fff" />
        </View>
        <Text style={s.successText}>Order Placed</Text>
        <Text style={s.orderRef}>#{orderNumber}</Text>
      </View>

      <View style={s.surface}>
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Date / time strip — no cashier */}
          <View style={s.metaStrip}>
            <View style={s.metaCell}>
              <View style={s.metaIconDisk}>
                <MaterialIcons name="event" size={16} color={NAVY} />
              </View>
              <View style={{ marginLeft: 8 }}>
                <Text style={s.metaCaption}>DATE</Text>
                <Text style={s.metaValue}>{dateStr}</Text>
              </View>
            </View>
            <View style={s.metaSep} />
            <View style={s.metaCell}>
              <View style={s.metaIconDisk}>
                <MaterialIcons name="access-time" size={16} color={NAVY} />
              </View>
              <View style={{ marginLeft: 8 }}>
                <Text style={s.metaCaption}>TIME</Text>
                <Text style={s.metaValue}>{timeStr}</Text>
              </View>
            </View>
          </View>

          {/* Location strip — frozen value captured at Validate Payment.
              Tap opens the map modal if we have coords; otherwise it's
              non-interactive (no retry — the strict gate guarantees a fix
              by the time we reach this screen). */}
          <TouchableOpacity
            activeOpacity={capturedLocation ? 0.7 : 1}
            onPress={() => {
              if (capturedLocation && (capturedLocation.locationName || capturedLocation.latitude != null)) {
                setLocationModalVisible(true);
              }
            }}
            style={[s.metaStrip, { marginTop: 8 }]}
          >
            <View style={[s.metaCell, { flex: 1 }]}>
              <View style={s.metaIconDisk}>
                <MaterialIcons name="place" size={16} color={NAVY} />
              </View>
              <View style={{ marginLeft: 8, flex: 1 }}>
                <Text style={s.metaCaption}>LOCATION</Text>
                <Text style={s.metaValue} numberOfLines={2}>
                  {capturedLocation && (capturedLocation.locationName || capturedLocation.latitude != null)
                    ? (capturedLocation.locationName || `${Number(capturedLocation.latitude).toFixed(5)}, ${Number(capturedLocation.longitude).toFixed(5)}`)
                    : 'Location unavailable'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Plain paper-receipt preview — black on white, mirrors the print output */}
          <View style={s.paperOuter}>
            <Text style={s.paperSectionLabel}>RECEIPT PREVIEW</Text>
            <View style={s.paperSheet}>
              {/* Company header — sourced from Odoo res.company (cached at login). */}
              <Text style={s.paperCompany}>{companyProfile?.name || 'Company'}</Text>
              {companyProfile?.street ? <Text style={s.paperMetaLine}>{companyProfile.street}</Text> : null}
              {companyProfile?.street2 ? <Text style={s.paperMetaLine}>{companyProfile.street2}</Text> : null}
              {[companyProfile?.city, companyProfile?.state, companyProfile?.zip].filter(Boolean).length ? (
                <Text style={s.paperMetaLine}>
                  {[companyProfile?.city, companyProfile?.state, companyProfile?.zip].filter(Boolean).join(', ')}
                </Text>
              ) : null}
              {companyProfile?.country ? <Text style={s.paperMetaLine}>{companyProfile.country}</Text> : null}
              {companyProfile?.phone ? <Text style={s.paperMetaLine}>{companyProfile.phone}</Text> : null}
              {companyProfile?.email ? <Text style={s.paperMetaLine}>{companyProfile.email}</Text> : null}

              <View style={s.paperRule} />

              {/* INVOICE title block */}
              <View style={s.paperTitleBox}>
                <Text style={s.paperTitle}>INVOICE / فاتورة</Text>
              </View>

              {/* Meta — two balanced rows:
                  Customer (left) | Cashier (right)
                  Date     (left) | No      (right) */}
              <View style={s.paperMetaRow}>
                <Text style={[s.paperPlain, { flex: 1, textAlign: 'left' }]} numberOfLines={1}>
                  {(customer && (customer.name || customer.display_name || customer.partner_name))
                    ? `Customer: ${customer.name || customer.display_name || customer.partner_name}`
                    : ''}
                </Text>
                <Text style={[s.paperPlain, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>{`Cashier: ${cashierName}`}</Text>
              </View>
              <View style={s.paperMetaRow}>
                <Text style={[s.paperPlain, { flex: 1, textAlign: 'left' }]}>Date: {dateStr}</Text>
                <Text style={[s.paperPlain, { flex: 1, textAlign: 'right' }]}>No: {orderNumber}</Text>
              </View>

              {/* Items table */}
              <View style={s.paperTableHead}>
                <Text style={[s.paperHeadCell, { flex: 0.4 }]}>#</Text>
                <Text style={[s.paperHeadCell, { flex: 2 }]}>Product</Text>
                <Text style={[s.paperHeadCell, { flex: 0.6, textAlign: 'center' }]}>Qty</Text>
                <Text style={[s.paperHeadCell, { flex: 0.9, textAlign: 'right' }]}>Unit</Text>
                <Text style={[s.paperHeadCell, { flex: 0.9, textAlign: 'right' }]}>Disc</Text>
                <Text style={[s.paperHeadCell, { flex: 1, textAlign: 'right' }]}>Total</Text>
              </View>
              {items.map((item, idx) => {
                const itemTotal = item.subtotal || ((item.price * item.qty) - (item.discount_amount || 0));
                const itemNote = item.customer_note || item.note || '';
                return (
                  <View key={idx}>
                    <View style={s.paperRow}>
                      <Text style={[s.paperPlain, { flex: 0.4 }]}>{idx + 1}.</Text>
                      <View style={{ flex: 2 }}>
                        <Text style={s.paperPlain} numberOfLines={1}>{item.name || 'Product'}</Text>
                        {itemNote ? (
                          <Text style={s.paperItemNote} numberOfLines={2}>{`📝 ${itemNote}`}</Text>
                        ) : null}
                      </View>
                      <Text style={[s.paperPlain, { flex: 0.6, textAlign: 'center' }]}>{item.qty}</Text>
                      <Text style={[s.paperPlain, { flex: 0.9, textAlign: 'right' }]}>{displayNum(item.price)}</Text>
                      <Text style={[s.paperPlain, { flex: 0.9, textAlign: 'right' }]}>
                        {item.discount_amount > 0 ? `-${displayNum(item.discount_amount)}` : displayNum(0)}
                      </Text>
                      <Text style={[s.paperPlain, { flex: 1, textAlign: 'right' }]}>{displayNum(itemTotal)}</Text>
                    </View>
                    {idx < items.length - 1 ? <View style={s.paperDottedRule} /> : null}
                  </View>
                );
              })}

              <View style={[s.paperDottedRule, { marginTop: 6 }]} />

              {/* Totals */}
              <View style={s.paperTotalsRow}>
                <Text style={s.paperPlain}>Subtotal / المجموع الفرعي</Text>
                <Text style={s.paperPlainBold}>{displayNum(subtotal || total)}</Text>
              </View>
              {service > 0 ? (
                <View style={s.paperTotalsRow}>
                  <Text style={s.paperPlain}>Service</Text>
                  <Text style={s.paperPlainBold}>{displayNum(service)}</Text>
                </View>
              ) : null}
              {discount > 0 ? (
                <View style={s.paperTotalsRow}>
                  <Text style={s.paperPlain}>Discount / الخصم</Text>
                  <Text style={s.paperPlainBold}>-{displayNum(discount)}</Text>
                </View>
              ) : null}
              {tax > 0 ? (
                <View style={s.paperTotalsRow}>
                  <Text style={s.paperPlain}>Tax / الضريبة</Text>
                  <Text style={s.paperPlainBold}>{displayNum(tax)}</Text>
                </View>
              ) : null}

              <View style={s.paperHeavyRule} />
              <View style={s.paperTotalsRow}>
                <Text style={s.paperGrandLabel}>Grand Total / الإجمالي</Text>
                <Text style={s.paperGrandValue}>{displayNum(grandTotal)}</Text>
              </View>

              <View style={s.paperRule} />

              {/* Payment — when the order has 1+ pos.payment records we
                  list each one (so split payments show "Cash 500 / Card 500"
                  rather than just a single Cash line). Falls back to the
                  legacy Cash + Change layout while the fetch is in flight or
                  if Odoo returns no records. */}
              <Text style={s.paperPaymentTitle}>
                {(isSplit || /^split/i.test(seededPaymentMethodLabel))
                  ? 'Payment Details (Split) / تفاصيل الدفع'
                  : 'Payment Details / تفاصيل الدفع'}
              </Text>
              {payments.length > 0 ? (
                <>
                  {payments.map((p, idx) => (
                    <View key={p.id || idx} style={s.paperTotalsRow}>
                      <Text style={s.paperPlain}>{`${p.method_name || 'Payment'}:`}</Text>
                      <Text style={s.paperPlainBold}>{displayNum(p.amount)}</Text>
                    </View>
                  ))}
                  {changeAmount > 0 ? (
                    <View style={s.paperTotalsRow}>
                      <Text style={s.paperPlain}>Change / الباقي:</Text>
                      <Text style={s.paperPlainBold}>{displayNum(changeAmount)}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <View style={s.paperTotalsRow}>
                    <Text style={s.paperPlain}>{`${seededPaymentMethodLabel || 'Cash'}:`}</Text>
                    <Text style={s.paperPlainBold}>{displayNum(cashDisplay)}</Text>
                  </View>
                  <View style={s.paperTotalsRow}>
                    <Text style={s.paperPlain}>Change / الباقي:</Text>
                    <Text style={s.paperPlainBold}>{displayNum(changeAmount)}</Text>
                  </View>
                </>
              )}

              {/* Signatures — captured at checkout (customer + shop owner).
                  Only shown when at least one is present, matching the
                  printed receipt. */}
              {(signatures.customer || signatures.owner) ? (
                <View style={s.paperSigRow}>
                  <View style={s.paperSigCol}>
                    {signatures.customer ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${signatures.customer}` }}
                        style={s.paperSigImg}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={s.paperSigImg} />
                    )}
                    <View style={s.paperSigLine} />
                    <Text style={s.paperPlain} numberOfLines={1}>Customer / العميل</Text>
                  </View>
                  <View style={s.paperSigCol}>
                    {signatures.owner ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${signatures.owner}` }}
                        style={s.paperSigImg}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={s.paperSigImg} />
                    )}
                    <View style={s.paperSigLine} />
                    <Text style={s.paperPlain} numberOfLines={1}>Cashier / الكاشير</Text>
                  </View>
                </View>
              ) : null}

              <View style={[s.paperDottedRule, { marginTop: 8 }]} />

              {/* Footer */}
              <Text style={s.paperFooter}>Thank you for your purchase!</Text>
              <Text style={[s.paperFooter, { fontSize: 11 }]}>شكرا لشرائك!</Text>
            </View>
          </View>

          {/* Thank you footer */}
          <View style={s.thankYou}>
            <MaterialCommunityIcons name="hand-heart" size={22} color={ORANGE} />
            <Text style={s.thankYouText}>Thank you for your purchase!</Text>
            <Text style={s.thankYouSub}>شكرا لشرائك</Text>
          </View>
        </ScrollView>

        {/* Sticky bottom action — 3 small action chips + full-width Done CTA */}
        <View style={s.footer}>
          <View style={s.actionRow}>
            <TouchableOpacity
              onPress={() => startAction('preview')}
              activeOpacity={0.85}
              style={[s.actionChip, s.previewChip]}
            >
              <View style={s.actionIconDisk}>
                <MaterialIcons name="preview" size={20} color="#1E88E5" />
              </View>
              <Text style={s.actionChipText}>Preview</Text>
            </TouchableOpacity>

            {/* Download PDF (Credit) — only shown when this order was
                credit-finalized and has a linked Accounting → Invoicing
                record. Fetches the invoice PDF for that same order id. */}
            {linkedInvoiceId ? (
              <TouchableOpacity
                onPress={onDownloadCreditPdf}
                disabled={downloadingCredit}
                activeOpacity={0.85}
                style={[s.actionChip, s.previewChip, downloadingCredit && { opacity: 0.6 }]}
              >
                <View style={s.actionIconDisk}>
                  {downloadingCredit ? (
                    <ActivityIndicator color="#7B2D8E" size="small" />
                  ) : (
                    <MaterialIcons name="file-download" size={20} color="#7B2D8E" />
                  )}
                </View>
                <Text style={s.actionChipText} numberOfLines={2}>PDF (Credit)</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              onPress={() => startAction('download')}
              disabled={downloading}
              activeOpacity={0.85}
              style={[s.actionChip, s.downloadChip, downloading && { opacity: 0.6 }]}
            >
              <View style={s.actionIconDisk}>
                {downloading ? (
                  <ActivityIndicator color="#E85D04" size="small" />
                ) : (
                  <MaterialIcons name="file-download" size={20} color="#E85D04" />
                )}
              </View>
              <Text style={s.actionChipText}>Download</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => startAction('print')}
              disabled={printing}
              activeOpacity={0.85}
              style={[s.actionChip, s.printChip, printing && { opacity: 0.6 }]}
            >
              <View style={s.actionIconDisk}>
                {printing ? (
                  <ActivityIndicator color="#7B2D8E" size="small" />
                ) : (
                  <MaterialCommunityIcons name="printer" size={20} color="#7B2D8E" />
                )}
              </View>
              <Text style={s.actionChipText}>Print</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (capturedLocation && (capturedLocation.locationName || capturedLocation.latitude != null)) {
                  setLocationModalVisible(true);
                }
              }}
              activeOpacity={capturedLocation ? 0.85 : 1}
              style={[s.actionChip, s.locationChip]}
            >
              <View style={s.actionIconDisk}>
                <MaterialIcons name="place" size={20} color="#9333ea" />
              </View>
              <Text style={s.actionChipText}>Location</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={onDone}
            activeOpacity={0.85}
            style={s.doneBtn}
          >
            <MaterialIcons name="check-circle" size={20} color="#fff" />
            <Text style={s.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Print Preview Modal — shows the receipt HTML in a WebView */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top']}>
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
        </SafeAreaView>
      </Modal>

      {/* Location modal — shared component used by both this screen and
          the past-order detail. Opened by the bottom Location chip. */}
      <LocationModal
        isVisible={locationModalVisible}
        locationName={capturedLocation?.locationName}
        latitude={capturedLocation?.latitude}
        longitude={capturedLocation?.longitude}
        onClose={() => setLocationModalVisible(false)}
      />

      {/* Paper-size picker — fired by Preview / Download / Print chips.
          On select we close the picker and run the pending action with
          the chosen width. */}
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
    </SafeAreaView>
  );
};

const cardShadow = Platform.select({
  ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 3 },
});

const ctaShadow = (color) => Platform.select({
  ios: { shadowColor: color, shadowOpacity: 0.32, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 7 },
});

const s = StyleSheet.create({
  // Hero
  hero: {
    backgroundColor: NAVY,
    paddingTop: 6,
    paddingBottom: 56,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginBottom: 18 },
  heroIconBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroSpacer: {
    width: 32, height: 32,
    backgroundColor: 'transparent',
  },
  heroTitle: {
    flex: 1, color: '#fff', fontSize: 16, fontWeight: '800',
    textAlign: 'center', letterSpacing: 0.4,
  },
  successDisk: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#10b981',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.18)',
    marginBottom: 10,
  },
  successText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  orderRef: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', marginTop: 3 },

  // Surface
  surface: {
    flex: 1, backgroundColor: '#f6f7fb',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    marginTop: -22,
  },

  // Meta strip
  metaStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 12,
    marginBottom: 12,
    ...cardShadow,
  },
  metaCell: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  metaIconDisk: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#eef0f5',
    alignItems: 'center', justifyContent: 'center',
  },
  metaCaption: {
    color: '#8896ab', fontSize: 10, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2,
  },
  metaValue: { color: NAVY, fontSize: 13, fontWeight: '800' },
  metaSep: { width: 1, height: 32, backgroundColor: '#eef0f5', marginHorizontal: 8 },

  // Cards
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12,
    ...cardShadow,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardHeaderIcon: {
    width: 28, height: 28, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: NAVY, letterSpacing: 0.3 },
  qtyChip: { backgroundColor: '#fff7ed', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  qtyChipText: { color: '#9a3412', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // Key-value rows
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvLabel: { color: '#8896ab', fontSize: 12, fontWeight: '600' },
  kvValue: { color: NAVY, fontSize: 13, fontWeight: '700', maxWidth: '60%', textAlign: 'right' },
  kvDivider: { height: 1, backgroundColor: '#f1f2f6' },

  // Items list
  emptyText: { color: '#9ca3af', fontSize: 12, fontWeight: '500', paddingVertical: 12, textAlign: 'center' },
  lineRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#f1f2f6',
  },
  lineNumDisk: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#eef0f5',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  lineNumText: { color: NAVY, fontSize: 11, fontWeight: '800' },
  lineName: { color: NAVY, fontSize: 13, fontWeight: '800' },
  lineMeta: { color: '#8896ab', fontSize: 11, fontWeight: '600', marginTop: 2 },
  lineAmt: { color: NAVY, fontSize: 13, fontWeight: '900', marginLeft: 8 },

  // Total row (grand)
  totalDivider: { height: 1.5, backgroundColor: NAVY, marginTop: 8, marginBottom: 6 },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  grandTotalLabel: { color: NAVY, fontSize: 14, fontWeight: '800' },
  grandTotalValue: { color: ORANGE, fontSize: 22, fontWeight: '900', letterSpacing: 0.3 },

  // Payment card (navy)
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  payLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  payValue: { color: '#fff', fontSize: 14, fontWeight: '900' },
  payRowDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },

  // Plain paper-receipt preview — black on white, no colour
  paperOuter: {
    marginBottom: 12,
  },
  paperSectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#8896ab',
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: 6, marginLeft: 2,
  },
  paperSheet: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#d1d5db',
    paddingVertical: 14, paddingHorizontal: 14,
  },
  paperCompany: {
    fontSize: 13, fontWeight: '700', color: '#000',
    textAlign: 'center', marginBottom: 4,
  },
  paperMetaLine: {
    fontSize: 11, color: '#000', textAlign: 'center', marginBottom: 2,
  },
  paperRule: {
    height: 0, borderBottomWidth: 1, borderBottomColor: '#000',
    marginVertical: 8,
  },
  paperHeavyRule: {
    height: 0, borderBottomWidth: 2, borderBottomColor: '#000',
    marginVertical: 6,
  },
  paperDottedRule: {
    height: 0, borderBottomWidth: 1, borderBottomColor: '#000',
    borderStyle: 'dashed', marginTop: 4, marginBottom: 4,
  },
  paperTitleBox: {
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000',
    paddingVertical: 6, marginVertical: 4,
  },
  paperTitle: {
    fontSize: 12, fontWeight: '700', color: '#000', textAlign: 'center',
  },
  paperCustomerBox: {
    borderWidth: 1, borderColor: '#000',
    paddingVertical: 6, paddingHorizontal: 8, marginVertical: 6,
  },
  paperCustomerHeader: {
    fontSize: 11, fontWeight: '700', color: '#000',
    textAlign: 'center', marginBottom: 4,
  },
  paperCustomerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 2,
  },
  paperMetaRow: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 6,
  },
  paperTableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: '#000',
    paddingBottom: 4, marginTop: 8, marginBottom: 4,
  },
  paperHeadCell: {
    fontSize: 11, fontWeight: '700', color: '#000',
  },
  paperRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4,
  },
  paperPlain: {
    fontSize: 11, color: '#000',
  },
  // Order note under the product name — small italic line so the cashier
  // / customer can see the note without it competing with the product
  // title. Mirrors the receipt PDF rendering in invoiceHtml.js.
  paperItemNote: {
    fontSize: 9,
    color: '#555',
    fontStyle: 'italic',
    marginTop: 2,
  },
  paperPlainBold: {
    fontSize: 11, fontWeight: '700', color: '#000',
  },
  paperTotalsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 3,
  },
  paperGrandLabel: {
    fontSize: 13, fontWeight: '700', color: '#000',
  },
  paperGrandValue: {
    fontSize: 13, fontWeight: '700', color: '#000',
  },
  paperPaymentTitle: {
    fontSize: 12, fontWeight: '700', color: '#000',
    textDecorationLine: 'underline', textAlign: 'center',
    marginTop: 4, marginBottom: 4,
  },
  paperFooter: {
    fontSize: 12, color: '#000', textAlign: 'center',
    marginTop: 4,
  },

  // Signature block on the paper preview — two equal columns (Customer +
  // Shop Owner) mirroring the printed receipt.
  paperSigRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#000',
  },
  paperSigCol: { flex: 1, alignItems: 'center' },
  paperSigImg: { width: '100%', height: 48, backgroundColor: '#fff' },
  paperSigLine: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#000',
    marginTop: 4,
    marginBottom: 2,
  },

  // Thank you
  thankYou: { alignItems: 'center', paddingVertical: 18 },
  thankYouText: { color: NAVY, fontSize: 14, fontWeight: '800', marginTop: 6 },
  thankYouSub: { color: '#8896ab', fontSize: 12, fontWeight: '600', marginTop: 2 },

  // Footer — 3 soft action chips on top + full-width Done CTA
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14,
    backgroundColor: '#fff',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: -6 } },
      android: { elevation: 14 },
    }),
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  actionChip: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1.2,
  },
  previewChip: {
    backgroundColor: '#e7f1fd',
    borderColor: '#1E88E5',
  },
  downloadChip: {
    backgroundColor: '#fdecdc',
    borderColor: '#E85D04',
  },
  printChip: {
    backgroundColor: '#f3e7f5',
    borderColor: '#7B2D8E',
  },
  locationChip: {
    backgroundColor: '#f3e8ff',
    borderColor: '#9333ea',
  },

  actionIconDisk: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  actionChipText: {
    color: '#1a1a2e',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: ORANGE,
    gap: 8,
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.32, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 8 },
    }),
  },
  doneText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    marginLeft: 4,
    letterSpacing: 0.4,
  },

  // Preview modal header
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#eef0f5',
  },
  previewTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a2e' },
  previewClose: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center', justifyContent: 'center',
  },
});

export default CreateInvoicePreview;
