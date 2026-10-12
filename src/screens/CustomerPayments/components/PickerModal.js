// Centered pick-one popup for the receipt form (Journal, Payment Method).
// Same zoom-in card as the confirm popup; rows styled like the company picker.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Modal from 'react-native-modal';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, FONT_FAMILY } from '@constants/theme';

const NAVY = COLORS.primaryThemeColor;

const PickerModal = ({ visible, title, items = [], selectedId, onPick, onClose }) => (
  <Modal
    isVisible={!!visible}
    animationIn="zoomIn"
    animationOut="zoomOut"
    backdropOpacity={0.5}
    onBackButtonPress={onClose}
    onBackdropPress={onClose}
    style={styles.modalCenter}
  >
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="close" size={22} color="#666" />
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {items.map((it) => {
          const active = it.id === selectedId;
          return (
            <TouchableOpacity
              key={it.id}
              style={[styles.row, active && styles.rowActive]}
              activeOpacity={0.85}
              onPress={() => onPick(it)}
            >
              <View style={[styles.radio, active && styles.radioActive]}>
                {active ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, active && { color: '#fff' }]} numberOfLines={1}>{it.label}</Text>
                {it.sub ? <Text style={[styles.rowSub, active && { color: 'rgba(255,255,255,0.8)' }]}>{it.sub}</Text> : null}
              </View>
              {active ? <MaterialIcons name="check-circle" size={20} color="#fff" /> : null}
            </TouchableOpacity>
          );
        })}
        {!items.length ? <Text style={styles.empty}>Nothing to choose.</Text> : null}
      </ScrollView>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  modalCenter: { margin: 24, justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18, maxHeight: '75%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { flex: 1, fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 8, backgroundColor: '#fff',
  },
  rowActive: { backgroundColor: NAVY, borderColor: NAVY },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#9ca3af',
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: '#fff' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  rowName: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  rowSub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#6b7280', marginTop: 2 },
  empty: { color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium, paddingVertical: 10, textAlign: 'center' },
});

export default PickerModal;
