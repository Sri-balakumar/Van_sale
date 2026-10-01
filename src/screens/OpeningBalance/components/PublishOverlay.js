// Full-screen, non-dismissible progress for the opening-balance publish, then
// the outcome: success, error (Odoo said no), or unknown (no answer — the
// server may still have finished, so Retry resumes rather than redoes).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import Modal from 'react-native-modal';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { STEP_TEXT } from '../usePublishOpeningBalance';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';
const SLOW_AFTER_MS = 30000;

const PublishOverlay = ({
  status, step, stepStartedAt, error, retryable = true, result, conflicts, money, onConflicts, onRetry, onClose, onDone,
}) => {
  const visible = ['running', 'confirming', 'success', 'error', 'unknown'].includes(status);
  const running = status === 'running';
  const [now, setNow] = useState(Date.now());
  const startedAt = useRef(null);

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      return undefined;
    }
    if (!startedAt.current) startedAt.current = Date.now();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = startedAt.current ? Math.max(0, Math.floor((now - startedAt.current) / 1000)) : 0;
  const slow = running && stepStartedAt && now - stepStartedAt > SLOW_AFTER_MS;

  return (
    <Modal
      isVisible={visible}
      animationIn="fadeIn"
      animationOut="fadeOut"
      backdropOpacity={0.6}
      onBackButtonPress={() => {}}
      onBackdropPress={() => {}}
      style={styles.modalCenter}
    >
      <View style={styles.card}>
        {running ? (
          <>
            <ActivityIndicator size="large" color={ORANGE} />
            <Text style={styles.title}>{STEP_TEXT[step] || 'Working…'}</Text>
            <Text style={styles.sub}>{elapsed}s</Text>
            {slow ? <Text style={styles.slow}>Taking longer than usual — please keep the app open.</Text> : null}
            <Text style={styles.hint}>Don't close the app or go back until this finishes.</Text>
          </>
        ) : null}

        {status === 'confirming' ? (
          <>
            <MaterialIcons name="warning-amber" size={56} color={ORANGE} />
            <Text style={styles.title}>Already has an opening balance</Text>
            <Text style={styles.sub}>
              These customers already have a confirmed or posted opening balance. Publishing adds another one on top.
            </Text>
            <ScrollView style={styles.conflictBox}>
              {(conflicts || []).map((c) => (
                <View key={c.id} style={styles.conflictRow}>
                  <Text style={styles.conflictName} numberOfLines={1}>{Array.isArray(c.partner_id) ? c.partner_id[1] : ''}</Text>
                  <Text style={styles.conflictMeta}>
                    {money(c.amount)} · {Array.isArray(c.opening_balance_id) ? c.opening_balance_id[1] : ''} · {c.state}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => onConflicts(false)}>
                <Text style={[styles.btnText, { color: '#374151' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: ORANGE }]} onPress={() => onConflicts(true)}>
                <Text style={styles.btnText}>Post anyway</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {status === 'success' ? (
          <>
            <MaterialIcons name="check-circle" size={64} color="#16a34a" />
            <Text style={styles.title}>{result?.alreadyPosted ? 'Already posted' : 'Opening balances posted'}</Text>
            <Text style={styles.sub}>
              {result?.customers} customer{result?.customers === 1 ? '' : 's'} · total {money(result?.total)}
            </Text>
            {result?.batchName ? <Text style={styles.ref}>{result.batchName}{result.moveName ? ` · ${result.moveName}` : ''}</Text> : null}
            <TouchableOpacity style={[styles.btn, { backgroundColor: NAVY, alignSelf: 'stretch', flex: 0, marginTop: 18 }]} onPress={onDone}>
              <Text style={styles.btnText}>Done</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {status === 'error' || status === 'unknown' ? (
          <>
            <MaterialIcons
              name={status === 'unknown' ? 'help-outline' : 'error-outline'}
              size={60}
              color={status === 'unknown' ? ORANGE : '#dc2626'}
            />
            <Text style={styles.title}>{status === 'unknown' ? 'No answer from the server' : 'Publish failed'}</Text>
            {status === 'unknown' ? (
              <Text style={styles.sub}>
                The upload may still have gone through. Retry checks the server first and only finishes what is missing — it never posts twice.
              </Text>
            ) : null}
            <ScrollView style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </ScrollView>
            <Text style={styles.hint}>Your entries are kept.</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
                <Text style={[styles.btnText, { color: '#374151' }]}>Close</Text>
              </TouchableOpacity>
              {retryable ? (
                <TouchableOpacity style={[styles.btn, { backgroundColor: ORANGE }]} onPress={onRetry}>
                  <Text style={styles.btnText}>Retry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalCenter: { margin: 24, justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 22, alignItems: 'center' },
  title: { fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827', marginTop: 14, textAlign: 'center' },
  sub: { fontSize: 13, color: '#4b5563', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  ref: { fontSize: 13, color: NAVY, fontFamily: FONT_FAMILY.urbanistBold, marginTop: 6 },
  slow: { fontSize: 12, color: ORANGE, fontFamily: FONT_FAMILY.urbanistSemiBold, marginTop: 10, textAlign: 'center' },
  hint: { fontSize: 12, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 12, textAlign: 'center' },
  errorBox: { maxHeight: 180, alignSelf: 'stretch', backgroundColor: '#fef2f2', borderRadius: 10, padding: 10, marginTop: 12 },
  errorText: { fontSize: 13, color: '#991b1b', fontFamily: FONT_FAMILY.urbanistMedium, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  conflictBox: { maxHeight: 200, alignSelf: 'stretch', backgroundColor: '#fff7ed', borderRadius: 10, padding: 10, marginTop: 12 },
  conflictRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#fde7d0' },
  conflictName: { fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistBold },
  conflictMeta: { fontSize: 12, color: '#9a3412', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 2 },
  btnGhost: { backgroundColor: '#f1f5f9' },
  btnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
});

export default PublishOverlay;
