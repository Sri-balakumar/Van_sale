// src/utils/deviceInfo.js
// Single source of truth for the human-readable device name used in device
// registration / heartbeat calls. Falls back to the app name when expo-device
// can't resolve a model (e.g. some emulators).
import * as Device from 'expo-device';

export const getDeviceName = () =>
  Device.deviceName || Device.modelName || Device.modelId || 'NEXGENN Van-Sale';
