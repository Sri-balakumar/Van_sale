// Admin password prompt guarding the opening-balance publish. The password is
// checked by Odoo itself (see usePublishOpeningBalance.authorize) and only
// lives in this component's state until submitted / closed.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Modal from 'react-native-modal';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, FONT_FAMILY } from '@constants/theme';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';
const MAX_ATTEMPTS = 3;
const LOCK_SECONDS = 60;

const AdminPasswordModal = ({ visible, title, message, defaultLogin, onSubmit, onCancel }) => {
  const [login, setLogin] = useState(defaultLogin || 'admin');
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [hidden, setHidden] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!visible) {
      setPassword('');
      setHidden(true);
      setError(null);
      setChecking(false);
    } else if (!showLogin) {
      setLogin(defaultLogin || 'admin');
    }
  }, [visible, defaultLogin, showLogin]);

  const locked = lockedUntil > now;
  useEffect(() => {
    if (!locked) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const submit = async () => {
    if (checking || locked || !password || !login.trim()) return;
    setChecking(true);
    setError(null);
    const res = await onSubmit(login.trim(), password);
    setChecking(false);
    if (res?.ok) {
      setPassword('');
      setFailures(0);
      return;
    }
    setPassword('');
    setError(res?.error || 'Could not verify the password.');
    if (res?.wrongPassword) {
      const n = failures + 1;
      if (n >= MAX_ATTEMPTS) {
        setFailures(0);
        setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
        setNow(Date.now());
      } else {
        setFailures(n);
      }
    }
  };

  const secondsLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  return (
    <Modal
      isVisible={visible}
      animationIn="zoomIn"
      animationOut="zoomOut"
      backdropOpacity={0.5}
      onBackButtonPress={checking ? undefined : onCancel}
      onBackdropPress={checking ? undefined : onCancel}
      avoidKeyboard
      style={styles.modalCenter}
    >
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <MaterialIcons name="lock-outline" size={22} color={NAVY} />
          <Text style={styles.title}>{title || 'Admin password'}</Text>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {showLogin ? (
          <>
            <Text style={styles.label}>Admin login</Text>
            <TextInput
              style={styles.input}
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!checking}
            />
          </>
        ) : (
          <Text style={styles.asUser}>
            Signing as <Text style={styles.asUserBold}>{login}</Text>
          </Text>
        )}

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={hidden}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            editable={!checking && !locked}
            onSubmitEditing={submit}
            returnKeyType="done"
            placeholder={locked ? `Locked — try again in ${secondsLeft}s` : 'Enter admin password'}
            placeholderTextColor="#9ca3af"
          />
          <TouchableOpacity onPress={() => setHidden((h) => !h)} style={styles.eye} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name={hidden ? 'visibility' : 'visibility-off'} size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {error ? (
          <Text style={styles.error}>
            {error}
            {failures > 0 && !locked ? ` (${MAX_ATTEMPTS - failures} attempt${MAX_ATTEMPTS - failures === 1 ? '' : 's'} left)` : ''}
          </Text>
        ) : null}
        {locked ? <Text style={styles.error}>Too many wrong attempts. Try again in {secondsLeft}s.</Text> : null}

        {!showLogin ? (
          <TouchableOpacity onPress={() => setShowLogin(true)} disabled={checking}>
            <Text style={styles.link}>Different admin?</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.btnRow}>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={checking}>
            <Text style={[styles.btnText, { color: '#374151' }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, (!password || locked || checking) && { opacity: 0.6 }]}
            onPress={submit}
            disabled={!password || locked || checking}
          >
            {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalCenter: { margin: 24, justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  message: { fontSize: 13, color: '#4b5563', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 8, lineHeight: 18 },
  asUser: { fontSize: 13, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 12 },
  asUserBold: { fontFamily: FONT_FAMILY.urbanistBold, color: '#111827' },
  label: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#374151', marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#111827', fontFamily: FONT_FAMILY.urbanistMedium, backgroundColor: '#fff',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, paddingRight: 40 },
  eye: { position: 'absolute', right: 10 },
  error: { color: '#dc2626', fontSize: 12, fontFamily: FONT_FAMILY.urbanistSemiBold, marginTop: 8 },
  link: { color: ORANGE, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, marginTop: 12 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, backgroundColor: NAVY, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnGhost: { backgroundColor: '#f1f5f9' },
  btnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
});

export default AdminPasswordModal;
