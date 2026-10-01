// Add / edit one customer's opening balance: customer first, then the five
// ageing buckets (whole numbers, default 0) with a live total.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Modal from 'react-native-modal';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { BUCKETS } from '@utils/openingBalanceXlsx';
import CustomerAutocomplete from './CustomerAutocomplete';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';

const zeroValues = () => BUCKETS.reduce((acc, b) => ({ ...acc, [b.key]: '0' }), {});
const valuesFromRow = (row) => BUCKETS.reduce((acc, b) => ({ ...acc, [b.key]: String(Number(row?.[b.key]) || 0) }), {});
// Digits only, no leading zeros ("007" → "7"); empty is allowed while typing.
const cleanAmount = (t) => String(t || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

const EntryModal = ({
  visible, initial, stagedRows, canCreate, customers, customersLoading, money, onSave, onCancel, onCreateCustomer,
}) => {
  const [partner, setPartner] = useState(null);
  const [values, setValues] = useState(zeroValues);
  const [editKey, setEditKey] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (!visible) return;
    if (initial?.row) {
      setPartner({ id: initial.row.partnerId, name: initial.row.partnerName });
      setValues(valuesFromRow(initial.row));
      setEditKey(initial.row.key);
    } else {
      setPartner(initial?.partner || null);
      setValues(initial?.values || zeroValues());
      setEditKey(null);
    }
    setNote(null);
  }, [visible, initial]);

  const total = useMemo(
    () => BUCKETS.reduce((s, b) => s + (parseInt(values[b.key], 10) || 0), 0),
    [values],
  );

  const pick = (p) => {
    const existing = stagedRows.find((r) => r.partnerId === p.id);
    if (existing) {
      setPartner(p);
      setValues(valuesFromRow(existing));
      setEditKey(existing.key);
      setNote('Already in the list — you are editing that entry.');
      return;
    }
    setPartner(p);
  };

  const save = () => {
    if (!partner || total <= 0) return;
    const row = {
      key: `p-${partner.id}`,
      partnerId: partner.id,
      partnerName: partner.name,
      ...BUCKETS.reduce((acc, b) => ({ ...acc, [b.key]: parseInt(values[b.key], 10) || 0 }), {}),
    };
    onSave(row, editKey);
  };

  const editingExisting = !!initial?.row;

  return (
    <Modal
      isVisible={visible}
      animationIn="zoomIn"
      animationOut="zoomOut"
      backdropOpacity={0.5}
      onBackButtonPress={onCancel}
      onBackdropPress={onCancel}
      avoidKeyboard
      style={styles.modalCenter}
    >
      <View style={styles.card}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{editingExisting ? 'Edit Opening Balance' : 'Add Opening Balance'}</Text>

          <Text style={styles.label}>Customer</Text>
          <CustomerAutocomplete
            key={visible ? 'open' : 'closed'}
            selected={partner}
            locked={editingExisting}
            canCreate={canCreate}
            customers={customers}
            customersLoading={customersLoading}
            initialText={initial?.text || ''}
            onSelect={pick}
            onClear={() => { setPartner(null); setEditKey(null); setNote(null); setValues(zeroValues()); }}
            onCreate={(name) => onCreateCustomer(name, values)}
          />
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <Text style={[styles.label, { marginTop: 16 }]}>Outstanding by age (days)</Text>
          {BUCKETS.map((b) => (
            <View key={b.key} style={styles.bucketRow}>
              <Text style={[styles.bucketLabel, !partner && styles.disabledText]}>{b.label} days</Text>
              <TextInput
                style={[styles.amountInput, !partner && styles.amountDisabled]}
                value={values[b.key]}
                editable={!!partner}
                selectTextOnFocus
                keyboardType="number-pad"
                maxLength={9}
                onChangeText={(t) => setValues((v) => ({ ...v, [b.key]: cleanAmount(t) }))}
                onBlur={() => setValues((v) => (v[b.key] === '' ? { ...v, [b.key]: '0' } : v))}
              />
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{money(total)}</Text>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onCancel}>
              <Text style={[styles.btnText, { color: '#374151' }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, (!partner || total <= 0) && { opacity: 0.5 }]}
              onPress={save}
              disabled={!partner || total <= 0}
            >
              <Text style={styles.btnText}>{editKey ? 'Update' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalCenter: { margin: 16, justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18, maxHeight: '92%' },
  title: { fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827', marginBottom: 6 },
  label: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#374151', marginTop: 10, marginBottom: 6 },
  note: { fontSize: 12, color: ORANGE, fontFamily: FONT_FAMILY.urbanistSemiBold, marginTop: 6 },
  bucketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  bucketLabel: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#111827' },
  disabledText: { color: '#c0c4cc' },
  amountInput: {
    width: 150, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 15, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold, textAlign: 'right', backgroundColor: '#fff',
  },
  amountDisabled: { backgroundColor: '#f3f4f6', color: '#9ca3af' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: '#eef0f4', paddingTop: 12, marginTop: 4,
  },
  totalLabel: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  totalValue: { fontSize: 18, fontFamily: FONT_FAMILY.urbanistBold, color: NAVY },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, backgroundColor: NAVY, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnGhost: { backgroundColor: '#f1f5f9' },
  btnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
});

export default EntryModal;
