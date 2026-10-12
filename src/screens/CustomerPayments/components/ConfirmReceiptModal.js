// Double-check popup shown before a payment receipt is posted — same look as
// the opening-balance admin prompt, but no password: the salesman confirms on
// their own and the receipt is recorded under their login.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Modal from 'react-native-modal';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, FONT_FAMILY } from '@constants/theme';

const NAVY = COLORS.primaryThemeColor;

const Row = ({ label, value, big }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, big && styles.rowValueBig]} numberOfLines={big ? 1 : 2}>{value || '—'}</Text>
  </View>
);

const ConfirmReceiptModal = ({ visible, summary, posting, onCancel, onConfirm }) => (
  <Modal
    isVisible={visible}
    animationIn="zoomIn"
    animationOut="zoomOut"
    backdropOpacity={0.5}
    onBackButtonPress={posting ? undefined : onCancel}
    onBackdropPress={posting ? undefined : onCancel}
    style={styles.modalCenter}
  >
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <MaterialIcons name="fact-check" size={22} color={NAVY} />
        <Text style={styles.title}>Confirm payment receipt</Text>
      </View>

      {summary ? (
        <View style={styles.rows}>
          <Row label="Customer" value={summary.customer} />
          <Row label="Amount" value={summary.amount} big />
          <Row label="Date" value={summary.date} />
          <Row label="Journal" value={summary.journal} />
          {summary.memo ? <Row label="Memo" value={summary.memo} /> : null}
          <Row label="Due" value={`${summary.dueNow}  →  ${summary.dueAfter}`} />
        </View>
      ) : null}

      <View style={styles.warning}>
        <Text style={styles.warningText}>
          ⚠️ This can't be undone. Check the amount and customer before confirming.
        </Text>
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={posting}>
          <Text style={[styles.btnText, { color: '#374151' }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, posting && { opacity: 0.7 }]} onPress={onConfirm} disabled={posting}>
          {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Yes, Confirm</Text>}
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  modalCenter: { margin: 24, justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  rows: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f2f6', paddingTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  rowLabel: { width: 78, fontSize: 13, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistSemiBold },
  rowValue: { flex: 1, fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistBold, textAlign: 'right' },
  rowValueBig: { fontSize: 20, color: NAVY },
  warning: {
    backgroundColor: '#fffbeb', borderColor: '#fcd34d', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10,
  },
  warningText: { fontSize: 13, color: '#92400e', fontFamily: FONT_FAMILY.urbanistSemiBold, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, backgroundColor: NAVY, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnGhost: { backgroundColor: '#f1f5f9' },
  btnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
});

export default ConfirmReceiptModal;
