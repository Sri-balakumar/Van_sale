// src/screens/DeviceSetup/DeviceQRScannerScreen.js
// App camera scans the QR shown on the Odoo New Device form.
// QR payload: {"a":"ng_reg","d":"dbname","rid":<record_id>}
// Server URL comes from route params (already entered in setup screen) — avoids localhost problem.
// On success → saves config and navigates to Login.

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
// expo-camera v14 (Expo SDK 50) — the modern CameraView/useCameraPermissions
// API lives under the `/next` sub-entry. They moved to the main entry only in v15+.
import { CameraView, useCameraPermissions } from 'expo-camera/next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import Text from '@components/Text';
import { FONT_FAMILY } from '@constants/theme';
import * as deviceApi from '@api/services/deviceApi';
import StyledConfirmModal from '@components/Modal/StyledConfirmModal';

const PURPLE = '#2E294E';

const DeviceQRScannerScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { deviceUUID, deviceModel, serverUrl, databaseName } = route.params || {};

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Point camera at the QR code on the admin screen');
  const [wrongDbInfo, setWrongDbInfo] = useState(null);
  // Generic slide-up dialog (logout popup style) — replaces native Alert.alert.
  // { title, message, confirmLabel, cancelLabel, onConfirm, onCancel }
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    requestPermission();
  }, []);

  const resetScanner = () => {
    setScanned(false);
    setLoading(false);
    setStatusMsg('Point camera at the QR code on the admin screen');
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);
    setStatusMsg('QR detected — registering device…');

    try {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (_) {
        setDialog({
          title: 'Invalid QR',
          message: 'This QR code is not a valid device registration code.',
          confirmLabel: 'Try Again', cancelLabel: 'Cancel',
          onConfirm: resetScanner, onCancel: () => navigation.goBack(),
        });
        return;
      }

      if (parsed.a !== 'ng_reg' || !parsed.d) {
        setDialog({
          title: 'Invalid QR',
          message: 'This QR code is not a device registration code.',
          confirmLabel: 'Try Again', cancelLabel: 'Cancel',
          onConfirm: resetScanner, onCancel: () => navigation.goBack(),
        });
        return;
      }

      if (databaseName && parsed.d !== databaseName) {
        setWrongDbInfo({ qrDb: parsed.d, expectedDb: databaseName });
        return;
      }

      // URL comes from setup screen params — NOT from QR (avoids localhost problem).
      // record_id (rid) from QR ensures we update the EXISTING record, not create a new one.
      const result = await deviceApi.registerFromScan({
        baseUrl: serverUrl,
        databaseName: parsed.d,
        deviceId: deviceUUID,
        deviceName: deviceModel || 'NEXGENN Van-Sale',
        recordId: parsed.rid || null,
      });

      if (result.status === 'registered' || result.status === 'already_registered') {
        await AsyncStorage.multiSet([
          ['device_server_url', serverUrl.replace(/\/+$/, '')],
          ['device_db_name', parsed.d],
          ['device_registered', 'true'],
        ]);
        setStatusMsg('Device registered! Redirecting…');
        navigation.reset({ index: 0, routes: [{ name: 'LoginScreenOdoo' }] });
      } else if (result.status === 'blocked') {
        const serial = result.serial_no || '—';
        console.log(`[DEVICE] QR scan blocked — serial=${serial}`);
        setDialog({
          title: 'Device Blocked',
          message: `This device has been blocked by the administrator.\n\nSerial: ${serial}\n\nGive this Serial to your admin to unblock the device.`,
          confirmLabel: 'OK',
          onConfirm: () => navigation.goBack(),
        });
      } else if (result.status === 'used') {
        console.log('[DEVICE] QR scan rejected — already used');
        setDialog({
          title: 'QR Already Used',
          message: 'This QR code has already been used. Tap New in the admin panel to generate a fresh QR, then scan it.',
          confirmLabel: 'Try Again', cancelLabel: 'Cancel',
          onConfirm: resetScanner, onCancel: () => navigation.goBack(),
        });
      } else {
        setDialog({
          title: 'Registration Failed',
          message: result.message || 'Could not register device. Try again.',
          confirmLabel: 'Try Again', cancelLabel: 'Cancel',
          onConfirm: resetScanner, onCancel: () => navigation.goBack(),
        });
      }
    } catch (err) {
      setDialog({
        title: 'Cannot Reach Server',
        message: `Check that the device and server are on the same network.\n\nServer URL: ${serverUrl}\n\nMake sure the URL uses the network IP (not localhost).`,
        confirmLabel: 'Try Again', cancelLabel: 'Cancel',
        onConfirm: resetScanner, onCancel: () => navigation.goBack(),
      });
    } finally {
      setLoading(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PURPLE} />
        <Text style={styles.centerText}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Camera permission denied.</Text>
        <Text style={styles.subText}>Enable camera access in device settings.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        onBarcodeScanned={scanned ? undefined : ({ data }) => handleBarCodeScanned({ data })}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>✕  Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Scan QR Code</Text>
          <View style={{ width: 80 }} />
        </View>

        <View style={styles.frameWrapper}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        </View>

        <View style={styles.bottomBar}>
          {loading ? (
            <ActivityIndicator size="small" color="#fff" style={{ marginBottom: 8 }} />
          ) : null}
          <Text style={styles.statusText}>{statusMsg}</Text>
          <Text style={styles.subStatusText}>
            Open the admin panel → Device Registry → New Device — scan the QR shown there
          </Text>
        </View>
      </View>

      <StyledConfirmModal
        isVisible={!!wrongDbInfo}
        title="Wrong Database"
        message={
          wrongDbInfo
            ? `This QR was generated for database "${wrongDbInfo.qrDb}", but you selected "${wrongDbInfo.expectedDb}" on the setup screen.\n\nAsk your admin to generate a new QR from database "${wrongDbInfo.expectedDb}", or go back and pick "${wrongDbInfo.qrDb}" instead.`
            : ''
        }
        confirmLabel="Try Again"
        cancelLabel="Go Back"
        onConfirm={() => { setWrongDbInfo(null); resetScanner(); }}
        onCancel={() => { setWrongDbInfo(null); navigation.goBack(); }}
      />

      <StyledConfirmModal
        isVisible={!!dialog}
        title={dialog?.title}
        message={dialog?.message}
        confirmLabel={dialog?.confirmLabel || 'OK'}
        cancelLabel={dialog?.cancelLabel}
        onConfirm={() => { const d = dialog; setDialog(null); d?.onConfirm?.(); }}
        onCancel={() => { const d = dialog; setDialog(null); d?.onCancel?.(); }}
      />
    </View>
  );
};

const CORNER = 24;
const BORDER = 4;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  centerText: { fontSize: 16, color: '#333', marginTop: 16, textAlign: 'center' },
  subText: { fontSize: 13, color: '#888', marginTop: 8, textAlign: 'center' },
  backBtn: {
    marginTop: 24,
    backgroundColor: PURPLE,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backBtnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 15 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cancelBtn: { width: 80 },
  cancelText: { color: '#fff', fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold },
  topTitle: { color: '#fff', fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold },
  frameWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  frame: { width: 240, height: 240, position: 'relative' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
  topLeft:    { top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER },
  topRight:   { top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER },
  bottomRight:{ bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER },
  bottomBar: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  statusText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    textAlign: 'center',
    marginBottom: 8,
  },
  subStatusText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', lineHeight: 18 },
});

export default DeviceQRScannerScreen;
