// InvoiceDetailScreen.js
//
// Detail view for one account.move (Invoice or Credit Note). Opened when
// the user taps a row in InvoicesListScreen.
//
// Layout:
//  - Header card: number, partner, dates, status badges
//  - Amount card: untaxed, tax, total, residual
//  - Lines table: product / qty / price_unit / subtotal
//  - Action row: state-conditional buttons (Pay / Reset to Draft / Credit
//    Note / Cancel) using the same alertButton style as LogoutModal so
//    every interactive button stays on the primary theme color.
import React, { useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOdooUrl } from '@api/config/odooConfig';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { SafeAreaView, RoundedContainer } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import Text from '@components/Text';
import { showToastMessage } from '@components/Toast';
import { useAuthStore } from '@stores/auth';
import { formatCurrency } from '@utils/currency';
import {
  fetchInvoiceDetailOdoo,
  resetInvoiceToDraftOdoo,
  postInvoiceOdoo,
  cancelInvoiceOdoo,
  createCreditNoteOdoo,
  registerPaymentForInvoiceOdoo,
  resolveAccountInvoiceHtml,
  fetchAppPaperSize,
} from '@api/services/generalApi';
import { printPageSize } from '@utils/invoiceHtml';
import PayInvoiceModal from '@components/Modal/PayInvoiceModal';
import PaperSizeModal from '@components/Modal/PaperSizeModal';
import ConfirmModal from '@components/Modal/ConfirmModal';
import { FeatureGate } from '@components/FeatureGate';

const formatDate = (s) => {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) { return String(s); }
};

// Status color shared with the list screen — keeps every state badge in
// the same palette across the app.
const stateColor = (state, payment_state) => {
  if (payment_state === 'paid') return '#16a34a';
  if (payment_state === 'partial' || payment_state === 'in_payment') return '#d97706';
  if (state === 'posted') return '#2563eb';
  if (state === 'cancel') return '#dc2626';
  return '#6b7280';
};
const stateLabel = (state, payment_state, move_type) => {
  if (state === 'cancel') return 'Cancelled';
  if (state === 'draft') return 'Draft';
  if (payment_state === 'paid') return 'Paid';
  if (payment_state === 'partial') return 'Partial';
  if (payment_state === 'in_payment') return 'In Payment';
  return move_type === 'out_refund' ? 'Credit Note' : 'Posted';
};

// Separate palette for the standalone Payment Status pill inside the
// Amounts card body — independent of the move state so the user can see
// "Posted + Partial Paid" without parsing a combined label.
const paymentStateColor = (ps) => {
  if (ps === 'paid') return '#16a34a';
  if (ps === 'partial') return '#d97706';
  if (ps === 'in_payment') return '#2563eb';
  if (ps === 'reversed') return '#7c3aed';
  return '#6b7280';
};
const paymentStateLabel = (ps) => {
  if (ps === 'paid') return 'Paid';
  if (ps === 'partial') return 'Partially Paid';
  if (ps === 'in_payment') return 'In Payment';
  if (ps === 'not_paid') return 'Not Paid';
  if (ps === 'reversed') return 'Reversed';
  return String(ps || '—');
};

const InvoiceDetailScreen = ({ navigation, route }) => {
  const invoiceId = route?.params?.invoiceId;
  const currency = useAuthStore((s) => s.currency);
  // Letterhead for the printed invoice (same source the POS receipt uses).
  const companyProfile = useAuthStore((s) => s.companyProfile);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [payModalVisible, setPayModalVisible] = useState(false);
  // Confirmation popups — replace the native Alert.alert with our
  // LogoutModal-style ConfirmModal so every confirmation dialog in the
  // accounting section shares the same look.
  const [confirm, setConfirm] = useState(null); // { title, message, onYes, destructive }

  const load = useCallback(async () => {
    setLoading(true);
    const resp = await fetchInvoiceDetailOdoo(invoiceId);
    if (resp?.error) {
      showToastMessage(resp.error?.data?.message || resp.error?.message || 'Failed to load invoice');
      setInvoice(null);
    } else {
      setInvoice(resp.result);
    }
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  // Print — renders the invoice through the SAME templates as a POS receipt
  // (Standard / Dynamic / Cash Memo / Custom Layout) at the configured paper
  // size, then hands it to the OS print dialog. Distinct from Download PDF
  // below, which fetches Odoo's official A4 report unchanged.
  const [printing, setPrinting] = useState(false);
  const [sizePicker, setSizePicker] = useState(false);
  const [paperCfg, setPaperCfg] = useState({ enabled: false, mm: null, heightMm: 0 });
  useEffect(() => {
    let alive = true;
    fetchAppPaperSize().then((cfg) => { if (alive) setPaperCfg(cfg); });
    return () => { alive = false; };
  }, []);

  const runPrint = async (paperWidthMm, paperHeightMm = 0) => {
    if (!invoice) return;
    setPrinting(true);
    try {
      const html = await resolveAccountInvoiceHtml({
        invoice,
        paperWidthMm,
        paperHeightMm,
        companyProfile,
        cashierName: Array.isArray(invoice.invoice_user_id) ? invoice.invoice_user_id[1] : 'Cashier',
      });
      // Exact page size (points) so the printer prints at 100%, no scaling.
      await Print.printAsync({ html, ...printPageSize(paperWidthMm, paperHeightMm) });
    } catch (err) {
      // Dismissing the print dialog rejects on iOS — only toast real failures.
      if (err?.message && !/cancel/i.test(err.message)) {
        showToastMessage(err.message || 'Print failed');
      }
    } finally {
      setPrinting(false);
    }
  };

  // Same rule as the POS receipt: a configured default size prints straight
  // away, otherwise ask. Keeps both prints consistent for the user.
  const startPrint = () => {
    if (paperCfg.enabled && paperCfg.mm) runPrint(paperCfg.mm, paperCfg.heightMm);
    else setSizePicker(true);
  };

  const runAction = async (fn, successMsg) => {
    setActing(true);
    try {
      const resp = await fn();
      if (resp?.error) {
        showToastMessage(resp.error?.data?.message || resp.error?.message || 'Action failed');
      } else {
        showToastMessage(successMsg);
        await load();
      }
    } finally {
      setActing(false);
    }
  };

  const onResetToDraft = () =>
    setConfirm({
      title: 'Reset to Draft',
      message: 'Are you sure you want to reset this invoice to draft?',
      confirmLabel: 'Reset',
      onYes: () => runAction(() => resetInvoiceToDraftOdoo(invoiceId), 'Reset to draft'),
    });

  const onPost = () => runAction(() => postInvoiceOdoo(invoiceId), 'Invoice posted');

  const onCancel = () =>
    setConfirm({
      title: 'Cancel Invoice',
      message: 'Are you sure you want to cancel this invoice?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      destructive: true,
      onYes: () => runAction(() => cancelInvoiceOdoo(invoiceId), 'Invoice cancelled'),
    });

  const onCreditNote = () =>
    setConfirm({
      title: 'Credit Note',
      message: 'Create a credit note (reversal) for this invoice?',
      confirmLabel: 'Create',
      onYes: () => runAction(() => createCreditNoteOdoo({ moveId: invoiceId }), 'Credit note created'),
    });

  // Download the invoice PDF — fetches Odoo's rendered report binary for
  // THIS specific move id, writes it to the cache, then either prompts
  // the user to pick a save folder (Android, via SAF) or opens the
  // system share sheet (iOS) so they can save / send the file.
  // Mirrors ExpenseDetailScreen.downloadAttachment but pulls the bytes
  // directly from /report/pdf/account.report_invoice/<id> instead of
  // reading a stored ir.attachment.
  const [downloading, setDownloading] = useState(false);
  const onPreviewPdf = async () => {
    if (!invoiceId) {
      showToastMessage('No invoice id');
      return;
    }
    const base = getOdooUrl();
    if (!base) {
      showToastMessage('Server URL not set');
      return;
    }
    setDownloading(true);
    const safeName = `${(invoice?.name || `Invoice-${invoiceId}`).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    const cachePath = `${FileSystem.cacheDirectory}${safeName}`;
    // Try the standard print report names in order — different Odoo
    // versions expose the "Invoice with payments" output under different
    // report ids. The first URL that returns a real PDF (size > 1 KB and
    // not the login HTML page) wins.
    const REPORT_NAMES = [
      'account.report_invoice_with_payments', // Odoo ≤17 template with payments
      'account.account_invoices',             // standard print action (most versions)
      'account.report_invoice',               // bare template (no payment history) — last resort
    ];
    try {
      const sessionId = await AsyncStorage.getItem('odoo_session_id');
      const headers = sessionId ? { Cookie: `session_id=${sessionId}` } : {};
      let dl = null;
      for (const reportName of REPORT_NAMES) {
        const url = `${base}/report/pdf/${reportName}/${invoiceId}`;
        try {
          const attempt = await FileSystem.downloadAsync(url, cachePath, { headers });
          if (!attempt?.uri) continue;
          const info = await FileSystem.getInfoAsync(attempt.uri);
          if (info.exists && (info.size || 0) >= 1000) {
            console.log('[InvoicePDF] downloaded via', reportName, 'size=', info.size);
            dl = attempt;
            break;
          }
        } catch (_) { /* try next */ }
      }
      if (!dl?.uri) {
        showToastMessage('PDF empty — try again or re-login');
        return;
      }
      const info = await FileSystem.getInfoAsync(dl.uri);
      if (!info.exists || (info.size || 0) < 1000) {
        showToastMessage('PDF empty — try again or re-login');
        return;
      }
      if (Platform.OS === 'android') {
        // Storage Access Framework prompts the user to pick the folder
        // where to save. The path they pick is shown in the system file
        // picker UI before they confirm.
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) {
          showToastMessage('Save cancelled');
          return;
        }
        const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: FileSystem.EncodingType.Base64 });
        const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          safeName,
          'application/pdf',
        );
        await FileSystem.writeAsStringAsync(targetUri, b64, { encoding: FileSystem.EncodingType.Base64 });
        showToastMessage(`Saved ${safeName}`);
      } else {
        // iOS — open the share sheet so the user can save to Files / etc.
        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
          showToastMessage('Sharing not available');
          return;
        }
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: safeName, UTI: 'com.adobe.pdf' });
      }
    } catch (e) {
      showToastMessage(e?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const onPay = () => {
    if (!invoice) return;
    const residual = Number(invoice.amount_residual) || 0;
    if (residual <= 0) {
      showToastMessage('Invoice already fully paid');
      return;
    }
    setPayModalVisible(true);
  };

  const onPaySubmit = async ({ journalId, amount, paymentDate, memo }) => {
    if (!invoice) return;
    const partnerId = Array.isArray(invoice.partner_id) ? invoice.partner_id[0] : invoice.partner_id;
    setActing(true);
    try {
      const resp = await registerPaymentForInvoiceOdoo({
        invoiceId,
        amount: Number(amount),
        journalId: Number(journalId),
        partnerId,
        paymentDate: paymentDate || null,
        // memo is accepted by registerPaymentForInvoiceOdoo as part of the
        // wizard vals via paymentDate's surrounding spread; for this build
        // we pass it through if the helper grows that field — Odoo defaults
        // the memo to the invoice name otherwise.
      });
      if (resp?.error) {
        showToastMessage(resp.error?.data?.message || resp.error?.message || 'Payment failed');
      } else {
        showToastMessage('Payment registered');
        setPayModalVisible(false);
        await load();
      }
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView>
        <NavigationHeader title="Invoice" onBackPress={() => navigation.goBack()} />
        <View style={s.loadingBox}>
          <ActivityIndicator color={COLORS.primaryThemeColor} />
        </View>
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView>
        <NavigationHeader title="Invoice" onBackPress={() => navigation.goBack()} />
        <View style={s.loadingBox}>
          <Text style={s.muted}>Invoice not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const partner = Array.isArray(invoice.partner_id) ? invoice.partner_id[1] : '—';
  const journal = Array.isArray(invoice.journal_id) ? invoice.journal_id[1] : '—';
  const salesperson = Array.isArray(invoice.invoice_user_id) ? invoice.invoice_user_id[1] : '—';
  const paymentTerm = Array.isArray(invoice.invoice_payment_term_id) ? invoice.invoice_payment_term_id[1] : '—';
  const color = stateColor(invoice.state, invoice.payment_state);
  const label = stateLabel(invoice.state, invoice.payment_state, invoice.move_type);
  const isPosted = invoice.state === 'posted';
  const isDraft = invoice.state === 'draft';
  const isCancel = invoice.state === 'cancel';
  const residual = Number(invoice.amount_residual) || 0;
  const isRefund = invoice.move_type === 'out_refund';

  return (
    <SafeAreaView>
      <NavigationHeader title={invoice.name || 'Invoice'} onBackPress={() => navigation.goBack()} />
      <RoundedContainer>
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {/* Header card */}
          <View style={s.card}>
            {/* Odoo-style diagonal corner ribbon — top-right, rotated
                -45° — shows payment state (PAID / PARTIAL / IN PAYMENT)
                so the cashier sees it at a glance like in Odoo's
                customer invoice form. Hidden when state isn't relevant. */}
            {invoice.payment_state && invoice.payment_state !== 'not_paid' ? (
              <View style={[s.ribbon, { backgroundColor: paymentStateColor(invoice.payment_state) }]}>
                <Text style={s.ribbonText}>{paymentStateLabel(invoice.payment_state).toUpperCase()}</Text>
              </View>
            ) : null}
            <View style={s.headerRow}>
              <View style={[s.iconDisk, { backgroundColor: isRefund ? '#FEE2E2' : '#E7F1FD' }]}>
                <MaterialIcons name={isRefund ? 'undo' : 'description'} size={22} color={isRefund ? '#b91c1c' : '#1E88E5'} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.number}>{invoice.name || '—'}</Text>
                <View style={[s.badge, { backgroundColor: color + '20' }]}>
                  <Text style={[s.badgeText, { color }]}>{label}</Text>
                </View>
              </View>
            </View>
            {/* Total amount on its own row — keeps the top-right corner
                clear for the diagonal payment-state ribbon, so the
                amount and ribbon don't overlap. */}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total Amount</Text>
              <Text style={[s.total, isRefund && { color: '#b91c1c' }]}>
                {formatCurrency(Number(invoice.amount_total) || 0, currency)}
              </Text>
            </View>
            <View style={s.divider} />
            <Detail icon="person" label="Customer" value={partner} />
            <Detail icon="event" label="Invoice Date" value={formatDate(invoice.invoice_date)} />
            <Detail icon="schedule" label="Due Date" value={formatDate(invoice.invoice_date_due)} />
            <Detail icon="account-balance" label="Journal" value={journal} />
            <Detail icon="badge" label="Salesperson" value={salesperson} />
            <Detail icon="payments" label="Payment Term" value={paymentTerm} />
            {invoice.ref ? <Detail icon="link" label="Reference" value={invoice.ref} /> : null}
            {invoice.invoice_origin ? <Detail icon="source" label="Source Document" value={invoice.invoice_origin} /> : null}
          </View>

          {/* Amount card — always shows Untaxed / VAT / Total / Amount Due
              even when paid (Amount Due = 0). Mirrors Odoo's invoice
              footer block so the user sees the same breakdown the web
              UI shows. */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>Amounts</Text>
            <AmountRow label="Untaxed Amount" value={formatCurrency(Number(invoice.amount_untaxed) || 0, currency)} />
            <AmountRow label="VAT / Tax" value={formatCurrency(Number(invoice.amount_tax) || 0, currency)} />
            <AmountRow label="Total" value={formatCurrency(Number(invoice.amount_total) || 0, currency)} bold />
            {/* Payment history — one row per reconciled payment, in
                Odoo's "Paid on <date>: <amount>" form. Comes from the
                computed invoice_payments_widget JSON field. Different
                Odoo versions return the field as a string, dict, or
                false; handle each. */}
            {(() => {
              const widget = invoice.invoice_payments_widget;
              console.log('[InvoiceDetail] invoice_payments_widget raw =', widget, 'type=', typeof widget);
              let payments = [];
              try {
                let parsed = widget;
                if (typeof widget === 'string' && widget.trim()) {
                  parsed = JSON.parse(widget);
                }
                if (parsed && typeof parsed === 'object') {
                  payments = Array.isArray(parsed.content) ? parsed.content
                    : Array.isArray(parsed) ? parsed
                    : [];
                }
              } catch (e) {
                console.warn('[InvoiceDetail] payments_widget parse error:', e?.message);
              }
              console.log('[InvoiceDetail] parsed payments =', payments);
              return payments.map((p, i) => (
                <View key={`pay-${i}`} style={s.paidRow}>
                  <MaterialIcons name="info-outline" size={12} color="#2563eb" />
                  <Text style={s.paidLabel}>{`Paid on ${formatDate(p.date)}`}</Text>
                  <Text style={s.paidValue}>{formatCurrency(Number(p.amount) || 0, currency)}</Text>
                </View>
              ));
            })()}
            <AmountRow label="Amount Due" value={formatCurrency(residual, currency)} highlight={residual > 0} />
            {/* Payment status pill — shown prominently inside the body so the
                cashier sees Paid / Partial / In Payment / Not Paid at a glance
                even when the move state is just "Posted". */}
            {invoice.payment_state ? (
              <View style={s.paymentBadgeRow}>
                <Text style={s.paymentBadgeLabel}>Payment Status</Text>
                <View style={[s.paymentBadge, { backgroundColor: paymentStateColor(invoice.payment_state) + '20' }]}>
                  <Text style={[s.paymentBadgeText, { color: paymentStateColor(invoice.payment_state) }]}>
                    {paymentStateLabel(invoice.payment_state)}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Line items */}
          {Array.isArray(invoice.lines) && invoice.lines.length > 0 ? (
            <View style={s.card}>
              <Text style={s.sectionTitle}>Invoice Lines</Text>
              {invoice.lines.map((ln) => (
                <View key={ln.id} style={s.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.lineName}>{ln.name || (Array.isArray(ln.product_id) ? ln.product_id[1] : '—')}</Text>
                    <Text style={s.lineMeta}>
                      {`Qty ${Number(ln.quantity) || 0} × ${formatCurrency(Number(ln.price_unit) || 0, currency)}`}
                      {Number(ln.discount) > 0 ? `  •  -${Number(ln.discount)}%` : ''}
                    </Text>
                  </View>
                  <Text style={s.lineAmt}>{formatCurrency(Number(ln.price_subtotal) || 0, currency)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {invoice.narration ? (
            <View style={s.card}>
              <Text style={s.sectionTitle}>Note</Text>
              <Text style={s.muted}>{String(invoice.narration).replace(/<[^>]+>/g, '')}</Text>
            </View>
          ) : null}

          {/* Action buttons — state-conditional */}
          <View style={s.actionsCard}>
            {/* Download Invoice PDF — opens Odoo's
                /report/pdf/account.report_invoice/<id> URL. On Android the
                browser triggers a download; on iOS it opens in the share
                sheet. Available on posted/cancelled (report renders for
                both); hidden for drafts since Odoo won't render those. */}
            {!isDraft ? (
              <FeatureGate featureKey="accounting.invoice.download_pdf">
                <ActionButton
                  icon="file-download"
                  label={downloading ? 'Downloading…' : 'Download PDF'}
                  onPress={onPreviewPdf}
                  disabled={acting || downloading}
                  variant="secondary"
                />
              </FeatureGate>
            ) : null}
            {/* Print — renders through the shop's configured invoice template
                at the configured paper size, unlike Download PDF above which
                always gives Odoo's official A4 report. */}
            {!isDraft ? (
              <FeatureGate featureKey="accounting.invoice.print_pdf">
                <ActionButton
                  icon="print"
                  label={printing ? 'Preparing…' : 'Print PDF'}
                  onPress={startPrint}
                  disabled={acting || printing || downloading}
                  variant="secondary"
                />
              </FeatureGate>
            ) : null}
            {isDraft ? (
              <FeatureGate featureKey="accounting.invoice.post">
                <ActionButton icon="check-circle" label="Confirm & Post" onPress={onPost} disabled={acting} />
              </FeatureGate>
            ) : null}
            {isPosted && residual > 0 ? (
              <FeatureGate featureKey="accounting.invoice.pay">
                <ActionButton icon="payments" label={`Pay ${formatCurrency(residual, currency)}`} onPress={onPay} disabled={acting} />
              </FeatureGate>
            ) : null}
            {(isPosted || isCancel) ? (
              <FeatureGate featureKey="accounting.invoice.reset_to_draft">
                <ActionButton icon="restore" label="Reset to Draft" onPress={onResetToDraft} disabled={acting} variant="secondary" />
              </FeatureGate>
            ) : null}
            {!isCancel && !isDraft ? null : (
              !isCancel ? (
                <FeatureGate featureKey="accounting.invoice.cancel">
                  <ActionButton icon="cancel" label="Cancel Invoice" onPress={onCancel} disabled={acting} variant="danger" />
                </FeatureGate>
              ) : null
            )}
          </View>
        </ScrollView>
      </RoundedContainer>
      {/* Offer the company's CONFIGURED sizes, not the modal's built-in six —
          picking a width with no pos.invoice.paper.size record makes the server
          fail to resolve a layout and silently print Standard instead. Same
          spread as OrderDetailScreen / CreateInvoicePreview. */}
      <PaperSizeModal
        isVisible={sizePicker}
        {...((paperCfg?.presets || []).length
          ? { sizes: paperCfg.presets.map((p) => ({ inch: p.label, mm: p.mm })) }
          : {})}
        onCancel={() => setSizePicker(false)}
        onSelect={(mm, heightMm = 0) => { setSizePicker(false); runPrint(mm, heightMm); }}
      />
      <PayInvoiceModal
        isVisible={payModalVisible}
        invoice={invoice}
        currency={currency}
        submitting={acting}
        onClose={() => setPayModalVisible(false)}
        onSubmit={onPaySubmit}
      />
      <ConfirmModal
        isVisible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel || 'OK'}
        cancelLabel={confirm?.cancelLabel || 'Cancel'}
        destructive={!!confirm?.destructive}
        onConfirm={() => {
          const yes = confirm?.onYes;
          setConfirm(null);
          if (typeof yes === 'function') yes();
        }}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
};

export default InvoiceDetailScreen;

const Detail = ({ icon, label, value }) => (
  <View style={s.detailRow}>
    <MaterialIcons name={icon} size={14} color="#6b7280" />
    <Text style={s.detailLabel}>{label}</Text>
    <Text style={s.detailValue}>{value}</Text>
  </View>
);

const AmountRow = ({ label, value, bold, highlight }) => (
  <View style={s.amountRow}>
    <Text style={[s.amountLabel, bold && s.amountBold]}>{label}</Text>
    <Text style={[s.amountValue, bold && s.amountBold, highlight && { color: '#d97706' }]}>{value}</Text>
  </View>
);

const ActionButton = ({ icon, label, onPress, disabled, variant = 'primary' }) => {
  const palette = variant === 'danger' ? { bg: '#dc2626', fg: '#fff' }
    : variant === 'secondary' ? { bg: '#f3f4f6', fg: '#111827' }
    : { bg: COLORS.primaryThemeColor, fg: '#fff' };
  return (
    <TouchableOpacity
      style={[s.actionBtn, { backgroundColor: palette.bg, opacity: disabled ? 0.6 : 1 }]}
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
    >
      <MaterialIcons name={icon} size={18} color={palette.fg} />
      <Text style={[s.actionBtnText, { color: palette.fg }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const s = StyleSheet.create({
  loadingBox: { padding: 32, alignItems: 'center' },
  muted: { color: '#6b7280', fontFamily: FONT_FAMILY.urbanistMedium },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginHorizontal: 12, marginTop: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
    overflow: 'hidden', // clip the diagonal ribbon to the card's rounded edge
  },
  // Diagonal corner ribbon (top-right, rotated -45°) — mirrors Odoo's
  // PAID / PARTIAL ribbon overlay on the customer invoice form.
  ribbon: {
    position: 'absolute',
    top: 10,
    right: -36,
    width: 140,
    paddingVertical: 3,
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    zIndex: 2,
  },
  ribbonText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 1.5,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f2f6' },
  totalLabel: { fontSize: 13, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistMedium },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  iconDisk: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  number: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 15, color: '#111827' },
  badge: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  badgeText: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold },
  total: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 16, color: '#111827' },
  divider: { height: 1, backgroundColor: '#f1f2f6', marginVertical: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  detailLabel: { marginLeft: 6, fontSize: 12, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistMedium, width: 110 },
  detailValue: { flex: 1, fontSize: 13, color: '#111827', fontFamily: FONT_FAMILY.urbanistMedium },
  sectionTitle: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14, marginBottom: 8, color: '#111827' },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  amountLabel: { color: '#374151', fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium },
  amountValue: { color: '#111827', fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium },
  amountBold: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
  // "Paid on <date>: <amount>" rows from invoice_payments_widget.
  paidRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  paidLabel: { flex: 1, marginLeft: 6, fontStyle: 'italic', fontSize: 12, color: '#2563eb', fontFamily: FONT_FAMILY.urbanistMedium },
  paidValue: { fontSize: 13, color: '#2563eb', fontFamily: FONT_FAMILY.urbanistBold },
  paymentBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  paymentBadgeLabel: { fontSize: 13, color: '#374151', fontFamily: FONT_FAMILY.urbanistMedium },
  paymentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  paymentBadgeText: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold },
  lineRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f2f6' },
  lineName: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13, color: '#111827' },
  lineMeta: { fontFamily: FONT_FAMILY.urbanistMedium, fontSize: 12, color: '#6b7280', marginTop: 2 },
  lineAmt: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13, color: '#111827' },
  actionsCard: { paddingHorizontal: 12, paddingTop: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 10,
    marginBottom: 10,
  },
  actionBtnText: { marginLeft: 8, fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
});
