// DueBreakdownModal — what the customer owes, broken down bill by bill.
// Stands to the Customer Due card exactly as TaxBreakdownModal stands to the
// Tax total: the card gives the number, this gives the detail behind it.
// Cloned from TaxBreakdownModal so the two popups are structurally identical;
// only the accent colour differs (amber "money owed" instead of orange).
//
// The two sections are NOT redundant, and the labels matter. The three totals
// are a frozen snapshot taken when the order was sold; the invoice list can
// only ever be live. Once the customer pays something the two legitimately
// disagree, and saying which is which is the difference between that reading
// as information and reading as a bug.
import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { formatCurrency } from '@utils/currency';

const NAVY = '#2E294E';
// The amber palette the Customer Due card and the POS payment screen's
// Previous Due card already use, so all three read as one feature.
const DUE_FG = '#9A3412';

const ctaShadow = (color) => Platform.select({
  ios: { shadowColor: color, shadowOpacity: 0.32, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 7 },
});

const num = (v, currency) => formatCurrency(v, currency || { symbol: '', name: '', position: 'before' });

// "2026-09-03" -> "03 Sep 2026". Returns the raw value for an unparseable date
// rather than printing "Invalid Date" on a row that is otherwise fine.
const shortDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const DueBreakdownModal = ({
  isVisible,
  order,
  snapshot,        // { previousDue, thisInvoiceDue, totalDue } — frozen at sale time
  openInvoices,    // { rows: [{ id, name, date, residual }], total } — live
  loading = false,
  currency,
  onClose,
}) => {
  const rows = Array.isArray(openInvoices?.rows) ? openInvoices.rows : [];
  const liveTotal = Number(openInvoices?.total || 0);
  const previousDue = Number(snapshot?.previousDue || 0);
  const thisInvoiceDue = Number(snapshot?.thisInvoiceDue || 0);
  const totalDue = Number(snapshot?.totalDue || 0);
  const orderName = order?.name && order.name !== '/' ? order.name : (order?.pos_reference || '');
  const customerName = order?.partner?.name || '';

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={s.card} activeOpacity={1} onPress={() => {}}>

          <View style={s.headerRow}>
            <View style={s.titleRow}>
              <MaterialIcons name="account-balance-wallet" size={22} color={NAVY} />
              <View style={{ marginLeft: 8, flex: 1 }}>
                <Text style={s.title}>Customer Due</Text>
                {customerName ? <Text style={s.subtitleMuted} numberOfLines={1}>{customerName}</Text> : null}
                {orderName ? <Text style={s.subtitleMuted}>{`Order ${orderName}`}</Text> : null}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={22} color={NAVY} />
            </TouchableOpacity>
          </View>

          <Text style={s.totalDueLine}>{`Total due ${num(totalDue, currency)}`}</Text>

          {/* Frozen — what the balance was on the day of this sale. */}
          <Text style={s.sectionLabel}>WHEN THIS ORDER WAS SOLD</Text>
          <View style={s.snapshotBox}>
            <View style={s.footerRow}>
              <Text style={s.footerLabel}>Previous Due</Text>
              <Text style={s.footerValue}>{num(previousDue, currency)}</Text>
            </View>
            <View style={s.footerRow}>
              <Text style={s.footerLabel}>This Order</Text>
              <Text style={s.footerValue}>{num(thisInvoiceDue, currency)}</Text>
            </View>
            <View style={s.footerDivider} />
            <View style={s.footerRow}>
              <Text style={s.grandLabel}>Total Due</Text>
              <Text style={s.grandValue}>{num(totalDue, currency)}</Text>
            </View>
          </View>

          {/* Live — which bills are actually unpaid right now. */}
          <Text style={s.sectionLabel}>OPEN INVOICES NOW</Text>
          {loading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={NAVY} />
              <Text style={s.loadingText}>Loading invoices…</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={s.loadingBox}>
              <Text style={s.loadingText}>No open invoices — this customer is settled up.</Text>
            </View>
          ) : (
            <>
              <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
                {rows.map((r, idx) => (
                  <View key={r.id || idx} style={s.lineCard}>
                    <Text style={s.lineName} numberOfLines={2}>{r.name}</Text>
                    <View style={s.lineRow}>
                      <Text style={s.lineMeta}>{shortDate(r.date) || '—'}</Text>
                      <Text style={s.lineDueValue}>{num(r.residual, currency)}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View style={s.footer}>
                <View style={s.footerRow}>
                  <Text style={s.grandLabel}>{`Owed now (${rows.length})`}</Text>
                  <Text style={s.grandValue}>{num(liveTotal, currency)}</Text>
                </View>
              </View>
            </>
          )}

          <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={s.closeBtnText}>Close</Text>
          </TouchableOpacity>

        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 2, borderColor: NAVY, padding: 18, width: '100%', maxWidth: 460, maxHeight: '85%' },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  title: { color: NAVY, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  subtitleMuted: { color: '#6b7280', fontSize: 11, fontWeight: '600', marginTop: 2 },
  totalDueLine: { color: DUE_FG, fontSize: 13, fontWeight: '800', marginTop: 4, marginBottom: 6 },

  sectionLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginTop: 10, marginBottom: 6 },
  snapshotBox: { backgroundColor: '#FFF7ED', borderRadius: 12, borderWidth: 1, borderColor: '#FED7AA', paddingHorizontal: 12, paddingVertical: 8 },

  scroll: { maxHeight: 220 },
  loadingBox: { alignItems: 'center', paddingVertical: 20 },
  loadingText: { color: '#6b7280', fontSize: 12, marginTop: 6, fontWeight: '600', textAlign: 'center' },

  lineCard: { backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  lineName: { color: NAVY, fontSize: 13, fontWeight: '800', marginBottom: 4 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  lineMeta: { color: '#475569', fontSize: 12, fontWeight: '500' },
  lineDueValue: { color: DUE_FG, fontSize: 13, fontWeight: '800' },

  footer: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  footerLabel: { color: '#475569', fontSize: 13, fontWeight: '500' },
  footerValue: { color: NAVY, fontSize: 13, fontWeight: '800' },
  footerDivider: { height: 1, backgroundColor: '#FED7AA', marginVertical: 6 },
  grandLabel: { color: NAVY, fontSize: 14, fontWeight: '800' },
  grandValue: { color: DUE_FG, fontSize: 18, fontWeight: '900' },

  closeBtn: { marginTop: 14, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: DUE_FG, ...ctaShadow(DUE_FG) },
  closeBtnText: { color: '#fff', fontWeight: '900', fontSize: 14, letterSpacing: 0.3 },
});

export default DueBreakdownModal;
