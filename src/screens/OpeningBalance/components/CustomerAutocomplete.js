// Type-ahead customer picker: suggests existing customers as you type and,
// when nothing matches the typed name exactly, offers to create it.
//
// The screen preloads the customer list once (`customers`), so suggestions
// show as soon as the picker opens and filter on the device per keystroke.
// The server is only searched when that list is missing or was cut off.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { searchOpeningBalanceCustomers } from '@api/services/openingBalanceApi';
import { normalizeName } from '@utils/openingBalanceXlsx';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';
const DEBOUNCE_MS = 300;
const MAX_SHOWN = 50;

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

const CustomerAutocomplete = ({
  selected, onSelect, onClear, onCreate, canCreate, locked, initialText = '', customers, customersLoading,
}) => {
  const [text, setText] = useState(initialText);
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const term = text.trim();
  const needServer = !customers || !customers.complete;

  const local = useMemo(() => {
    if (!customers) return [];
    const q = normalizeName(term);
    const digits = digitsOf(term);
    const rows = q
      ? customers.rows.filter((r) => normalizeName(r.name).includes(q)
        || (digits.length >= 3 && digitsOf(r.phone).includes(digits)))
      : customers.rows;
    return rows.slice(0, MAX_SHOWN);
  }, [customers, term]);

  useEffect(() => {
    if (selected || !needServer || term.length < 2) {
      requestId.current += 1;
      setRemote([]);
      setSearching(false);
      return undefined;
    }
    const id = ++requestId.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await searchOpeningBalanceCustomers(term);
        if (id !== requestId.current) return;
        setRemote(rows);
        setFailed(false);
      } catch (_) {
        if (id !== requestId.current) return;
        setRemote([]);
        setFailed(true);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, selected, needServer]);

  const results = useMemo(() => {
    const seen = new Set(local.map((r) => r.id));
    return [...local, ...remote.filter((r) => !seen.has(r.id))];
  }, [local, remote]);

  if (selected) {
    return (
      <View style={styles.chip}>
        <MaterialIcons name="person" size={18} color={NAVY} />
        <Text style={styles.chipText} numberOfLines={1}>{selected.name}</Text>
        {!locked ? (
          <TouchableOpacity onPress={() => { setText(selected.name); onClear(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={18} color="#6b7280" />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const busy = searching || (customersLoading && !customers);
  const exact = results.some((r) => normalizeName(r.name) === normalizeName(term));
  const showCreate = canCreate && term.length >= 2 && !busy && !exact;
  const showList = !!customers || term.length >= 2;

  return (
    <View>
      <View style={styles.inputRow}>
        <MaterialIcons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Type customer name or phone"
          placeholderTextColor="#9ca3af"
          autoCorrect={false}
          autoFocus
        />
        {busy ? <ActivityIndicator size="small" color={ORANGE} style={styles.spinner} /> : null}
      </View>
      {showList ? (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {results.map((r) => (
            <TouchableOpacity key={r.id} style={styles.item} onPress={() => onSelect({ id: r.id, name: r.name })}>
              <Text style={styles.itemName} numberOfLines={1}>{r.name}</Text>
              {r.phone || r.city ? (
                <Text style={styles.itemSub} numberOfLines={1}>{[r.phone, r.city].filter(Boolean).join(' · ')}</Text>
              ) : null}
            </TouchableOpacity>
          ))}
          {!busy && !results.length ? (
            <Text style={styles.empty}>{failed ? 'Search failed — check the connection.' : 'No customer found.'}</Text>
          ) : null}
          {showCreate ? (
            <TouchableOpacity style={[styles.item, styles.createItem]} onPress={() => onCreate(term)}>
              <MaterialIcons name="person-add-alt-1" size={18} color={ORANGE} />
              <Text style={styles.createText} numberOfLines={1}>Create “{term}”</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : (
        customersLoading ? <Text style={styles.hint}>Loading customers…</Text> : null
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  searchIcon: { position: 'absolute', left: 10, zIndex: 1 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingLeft: 36, paddingRight: 36,
    paddingVertical: 10, fontSize: 15, color: '#111827', fontFamily: FONT_FAMILY.urbanistMedium, backgroundColor: '#fff',
  },
  spinner: { position: 'absolute', right: 10 },
  list: { maxHeight: 220, marginTop: 6, borderWidth: 1, borderColor: '#eef0f4', borderRadius: 10 },
  item: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  itemName: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#111827' },
  itemSub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#9ca3af', marginTop: 2 },
  empty: { padding: 12, fontSize: 13, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium },
  hint: { marginTop: 8, fontSize: 12, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium },
  createItem: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 0 },
  createText: { flex: 1, fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: ORANGE },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
  },
  chipText: { flex: 1, fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
});

export default CustomerAutocomplete;
