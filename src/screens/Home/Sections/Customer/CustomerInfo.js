import React, { useEffect, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Platform,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
  Switch,
  Modal,
  FlatList,
  Linking,
} from 'react-native';
import { SafeAreaView } from '@components/containers';
import { MaterialIcons } from '@expo/vector-icons';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import {
  updatePartnerOdoo,
  createPartnerOdoo,
  updatePartnerIdProofOdoo,
} from '@api/services/generalApi';
import {
  primePartnerCache,
  getCachedPartnerDetails,
  getCachedPartnerProof,
  invalidatePartnerCache,
} from '@api/services/customerCache';
import { IdProofCards } from '@components/IdProof';
import Toast from 'react-native-toast-message';
import { useFeatureHidden } from '@components/FeatureGate';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';

const AVATAR_TINTS = ['#fde68a', '#bfdbfe', '#bbf7d0', '#fbcfe8', '#fed7aa', '#ddd6fe', '#fecaca'];
const tintFor = (id) => AVATAR_TINTS[Math.abs(Number(id) || 0) % AVATAR_TINTS.length];

// ─── Country Data ─────────────────────────────────────────────────
const COUNTRIES = [
  { name: 'Oman', dial: '+968', flag: '🇴🇲', digits: 8 },
  { name: 'UAE', dial: '+971', flag: '🇦🇪', digits: 9 },
  { name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', digits: 9 },
  { name: 'Qatar', dial: '+974', flag: '🇶🇦', digits: 8 },
  { name: 'Bahrain', dial: '+973', flag: '🇧🇭', digits: 8 },
  { name: 'Kuwait', dial: '+965', flag: '🇰🇼', digits: 8 },
  { name: 'India', dial: '+91', flag: '🇮🇳', digits: 10 },
  { name: 'Pakistan', dial: '+92', flag: '🇵🇰', digits: 10 },
  { name: 'Bangladesh', dial: '+880', flag: '🇧🇩', digits: 10 },
  { name: 'Sri Lanka', dial: '+94', flag: '🇱🇰', digits: 9 },
  { name: 'Nepal', dial: '+977', flag: '🇳🇵', digits: 10 },
  { name: 'Philippines', dial: '+63', flag: '🇵🇭', digits: 10 },
  { name: 'Indonesia', dial: '+62', flag: '🇮🇩', digits: 12 },
  { name: 'Malaysia', dial: '+60', flag: '🇲🇾', digits: 10 },
  { name: 'Singapore', dial: '+65', flag: '🇸🇬', digits: 8 },
  { name: 'Thailand', dial: '+66', flag: '🇹🇭', digits: 9 },
  { name: 'Vietnam', dial: '+84', flag: '🇻🇳', digits: 10 },
  { name: 'China', dial: '+86', flag: '🇨🇳', digits: 11 },
  { name: 'Japan', dial: '+81', flag: '🇯🇵', digits: 10 },
  { name: 'South Korea', dial: '+82', flag: '🇰🇷', digits: 10 },
  { name: 'Egypt', dial: '+20', flag: '🇪🇬', digits: 10 },
  { name: 'Jordan', dial: '+962', flag: '🇯🇴', digits: 9 },
  { name: 'Lebanon', dial: '+961', flag: '🇱🇧', digits: 8 },
  { name: 'Iraq', dial: '+964', flag: '🇮🇶', digits: 10 },
  { name: 'Iran', dial: '+98', flag: '🇮🇷', digits: 10 },
  { name: 'Turkey', dial: '+90', flag: '🇹🇷', digits: 10 },
  { name: 'United Kingdom', dial: '+44', flag: '🇬🇧', digits: 10 },
  { name: 'United States', dial: '+1', flag: '🇺🇸', digits: 10 },
  { name: 'Canada', dial: '+1', flag: '🇨🇦', digits: 10 },
  { name: 'Germany', dial: '+49', flag: '🇩🇪', digits: 11 },
  { name: 'France', dial: '+33', flag: '🇫🇷', digits: 9 },
  { name: 'Italy', dial: '+39', flag: '🇮🇹', digits: 10 },
  { name: 'Spain', dial: '+34', flag: '🇪🇸', digits: 9 },
  { name: 'Australia', dial: '+61', flag: '🇦🇺', digits: 9 },
  { name: 'South Africa', dial: '+27', flag: '🇿🇦', digits: 9 },
  { name: 'Brazil', dial: '+55', flag: '🇧🇷', digits: 11 },
  { name: 'Mexico', dial: '+52', flag: '🇲🇽', digits: 10 },
  { name: 'Russia', dial: '+7', flag: '🇷🇺', digits: 10 },
  { name: 'Yemen', dial: '+967', flag: '🇾🇪', digits: 9 },
];

const getMaxDigits = (dial) => COUNTRIES.find((c) => c.dial === dial)?.digits || 15;

const parsePhoneCountryCode = (phone) => {
  if (!phone || !phone.startsWith('+')) return { code: '+968', number: phone || '' };
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (phone.startsWith(c.dial)) {
      return { code: c.dial, number: phone.slice(c.dial.length) };
    }
  }
  return { code: '+968', number: phone.replace(/^\+/, '') };
};

// ─── Country Code Picker ──────────────────────────────────────────
const CountryCodePicker = ({ visible, onClose, onSelect, selectedDial }) => {
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);
  const filtered = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.dial.includes(search)
  );
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={cs.container}>
        <View style={cs.header}>
          <TouchableOpacity onPress={onClose} style={cs.closeBtn}>
            <Text style={cs.closeText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={cs.title}>Select Country</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={cs.searchBox}>
          <TextInput
            style={cs.searchInput}
            placeholder="Search country or code…"
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item, idx) => `${item.dial}-${item.name}-${idx}`}
          renderItem={({ item }) => {
            const isSelected = item.dial === selectedDial;
            return (
              <TouchableOpacity
                style={cs.row}
                activeOpacity={0.7}
                onPress={() => {
                  onSelect(item.dial);
                  onClose();
                }}
              >
                <Text style={cs.flag}>{item.flag}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={cs.country}>{item.name}</Text>
                  <Text style={cs.digits}>{item.digits} digits</Text>
                </View>
                <Text style={cs.dial}>{item.dial}</Text>
                {isSelected ? <Text style={cs.check}>✓</Text> : null}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
};

// ─── Main Screen — mirrors employee_attendance ContactsSheet form ─
const CustomerInfo = ({ navigation, route }) => {
  const { details, mode } = route?.params || {};
  const partnerId = details?.id || details?._id || null;
  const isNew = !partnerId;
  // mode: 'view' = read-only with Edit button, otherwise editable.
  // New contacts (no partnerId) always render in edit mode.
  const isView = mode === 'view' && !isNew;
  // Defense-in-depth: mode-aware gate so Save is hidden if the matching
  // App Features key is off for the current user.
  const saveOpHidden = useFeatureHidden(isNew ? 'customers.add' : 'customers.edit');

  // No initial loading gate — we hydrate the form from route.params
  // (which already has name/email/phone/address from the customer-list
  // row) so the screen renders immediately. The background fetch
  // refines fields the summary didn't include (vat, website, etc.).
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  // Pre-fill from the route-param summary so the screen has visible
  // values on the very first render — the network refine happens in
  // the effect below without blocking the user.
  const [form, setForm] = useState(() => {
    const parsed = details?.phone
      ? parsePhoneCountryCode(details.phone)
      : { code: '+968', number: '' };
    return {
      name: details?.name || '',
      email: details?.email || '',
      phone: parsed.number || '',
      country_code: parsed.code || '+968',
      is_company: false,
      street: '',
      street2: '',
      city: '',
      zip: '',
      company_name: '',
      function: '',
      website: '',
      vat: '',
      id_proof_front: null,
      id_proof_back: null,
    };
  });
  // Track whether each side changed since load — only the changed sides
  // are written back to Odoo on save. Avoids re-uploading the same
  // base64 every time the user edits an unrelated field.
  const [idProofChanged, setIdProofChanged] = useState({ front: false, back: false });

  useEffect(() => {
    if (!partnerId) return;
    let alive = true;
    // Hot path — the customer list primed the cache on row tap, so the
    // promises are already in flight or done by the time we mount.
    // Cold path — direct nav (e.g. post-create) with no prime: kick
    // off the fetches now and read the same promises back.
    if (!getCachedPartnerDetails(partnerId)) primePartnerCache(partnerId);
    Promise.all([
      getCachedPartnerDetails(partnerId),
      getCachedPartnerProof(partnerId),
    ])
      .then(([rec, proof]) => {
        if (!alive || !rec) return;
        const parsed = rec.phone ? parsePhoneCountryCode(rec.phone) : { code: '+968', number: '' };
        setForm((prev) => ({
          ...prev,
          name: rec.name || prev.name,
          email: rec.email || prev.email,
          phone: parsed.number || prev.phone,
          country_code: parsed.code || prev.country_code,
          is_company: !!rec.is_company,
          street: rec.street || '',
          street2: rec.street2 || '',
          city: rec.city || '',
          zip: rec.zip || '',
          company_name: rec.company_name || '',
          function: rec.function || '',
          website: rec.website || '',
          vat: rec.vat || '',
          id_proof_front: proof?.id_proof_front || null,
          id_proof_back: proof?.id_proof_back || null,
        }));
        setIdProofChanged({ front: false, back: false });
      })
      .catch(() => {
        Toast.show({ type: 'error', text1: 'Failed to load contact', position: 'bottom' });
      });
    return () => { alive = false; };
  }, [partnerId]);

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  // ID-proof picker callback — flips the matching `idProofChanged`
  // flag so handleSave knows to write that side back.
  const setIdProof = (side, base64) => {
    setForm((prev) => ({ ...prev, [side === 'front' ? 'id_proof_front' : 'id_proof_back']: base64 }));
    setIdProofChanged((prev) => ({ ...prev, [side]: true }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Toast.show({ type: 'error', text1: 'Name is required', position: 'bottom' });
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        email: form.email.trim() || false,
        phone: form.phone.trim() ? `${form.country_code}${form.phone.trim()}` : false,
        is_company: form.is_company,
        street: form.street.trim() || false,
        street2: form.street2.trim() || false,
        city: form.city.trim() || false,
        zip: form.zip.trim() || false,
        company_name: form.company_name.trim() || false,
        function: form.function.trim() || false,
        website: form.website.trim() || false,
        vat: form.vat.trim() || false,
      };
      const resp = isNew
        ? await createPartnerOdoo(data)
        : await updatePartnerOdoo(partnerId, data);
      if (resp?.error) {
        Toast.show({
          type: 'error',
          text1: 'Save failed',
          text2: resp.error.message || 'Could not save contact',
          position: 'bottom',
        });
        return;
      }
      // Drop any stale cached version so the next open re-fetches.
      if (partnerId) invalidatePartnerCache(partnerId);
      // ID proof writes go through a separate call so the main partner
      // write isn't blocked by the (possibly missing) custom binary
      // fields. We only send the side(s) that actually changed.
      const proofTargetId = isNew ? resp?.id || resp?.result : partnerId;
      // A screen that opened this form to create a customer (e.g. Opening
      // Balance) gets the new partner back to select it.
      const notifyCreated = () => {
        if (isNew && proofTargetId) route?.params?.onSaved?.({ id: proofTargetId, name: data.name });
      };
      if (proofTargetId && (idProofChanged.front || idProofChanged.back)) {
        const proofVals = {};
        if (idProofChanged.front) proofVals.id_proof_front = form.id_proof_front;
        if (idProofChanged.back) proofVals.id_proof_back = form.id_proof_back;
        const proofResp = await updatePartnerIdProofOdoo(proofTargetId, proofVals);
        if (proofResp?.error) {
          Toast.show({
            type: 'info',
            text1: 'Contact saved',
            text2: 'ID proof not saved — fields not configured on this Odoo',
            position: 'bottom',
          });
          notifyCreated();
          navigation.goBack();
          return;
        }
        // Proof changed too — clear the cache for the freshly-saved
        // partner so the next open re-fetches the new image.
        if (proofTargetId) invalidatePartnerCache(proofTargetId);
      }
      Toast.show({
        type: 'success',
        text1: isNew
          ? (resp?.partial ? 'Contact created (some fields skipped)' : 'Contact created')
          : (resp?.partial ? 'Contact saved (some fields skipped)' : 'Contact updated'),
        position: 'bottom',
      });
      notifyCreated();
      navigation.goBack();
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Save failed', text2: e?.message || '', position: 'bottom' });
    } finally {
      setSaving(false);
    }
  };

  const goToEdit = () => navigation.setParams({ mode: 'edit' });

  const renderAvatar = () => {
    const src = details?.image_url || partnerId
      ? `${(details?.image_url || '').split('?')[0] || ''}`
      : null;
    const fallbackInitial = (form.name || '?').trim().charAt(0).toUpperCase() || '?';
    if (!details?.image_url || imgFailed) {
      return (
        <View style={[s.heroAvatar, { backgroundColor: tintFor(partnerId) }]}>
          <Text style={s.heroAvatarInitial}>{fallbackInitial}</Text>
        </View>
      );
    }
    return (
      <Image
        source={{ uri: details.image_url }}
        style={s.heroAvatar}
        onError={() => setImgFailed(true)}
      />
    );
  };

  const InfoRow = ({ icon, label, value, onPress, last }) => {
    const Wrap = onPress ? TouchableOpacity : View;
    return (
      <Wrap
        style={[s.infoRow, last && { borderBottomWidth: 0 }]}
        activeOpacity={0.7}
        onPress={onPress}
      >
        <View style={s.infoIconDisk}>
          <MaterialIcons name={icon} size={18} color={NAVY} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.infoLabel}>{label}</Text>
          <Text style={s.infoValue} numberOfLines={3}>{value}</Text>
        </View>
        {onPress ? (
          <MaterialIcons name="chevron-right" size={20} color="#cbd5e1" />
        ) : null}
      </Wrap>
    );
  };

  const renderViewBody = () => {
    const fullPhone = form.phone ? `${form.country_code} ${form.phone}` : '';
    const addressLines = [form.street, form.street2, [form.city, form.zip].filter(Boolean).join(' ')]
      .filter(Boolean);
    const hasContact = fullPhone || form.email || form.website;
    const hasOther = !!form.vat;

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#F5F6FA' }}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={s.heroCard}>
          {renderAvatar()}
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={s.heroName} numberOfLines={2}>{form.name?.trim() || '—'}</Text>
            <View style={s.kindChip}>
              <MaterialIcons
                name={form.is_company ? 'apartment' : 'person'}
                size={13}
                color={NAVY}
              />
              <Text style={s.kindChipText}>{form.is_company ? 'Company' : 'Person'}</Text>
            </View>
            {!form.is_company && form.company_name ? (
              <Text style={s.heroMuted} numberOfLines={1}>at {form.company_name}</Text>
            ) : null}
            {!form.is_company && form.function ? (
              <Text style={s.heroMuted} numberOfLines={1}>{form.function}</Text>
            ) : null}
          </View>
        </View>

        {/* Action pills */}
        {(fullPhone || form.email) ? (
          <View style={s.actionRow}>
            {fullPhone ? (
              <TouchableOpacity
                style={[s.actionPill, { backgroundColor: '#dcfce7', borderColor: '#22c55e' }]}
                activeOpacity={0.85}
                onPress={() => Linking.openURL(`tel:${form.country_code}${form.phone}`)}
              >
                <MaterialIcons name="call" size={16} color="#166534" />
                <Text style={[s.actionPillText, { color: '#166534' }]}>Call</Text>
              </TouchableOpacity>
            ) : null}
            {form.email ? (
              <TouchableOpacity
                style={[s.actionPill, { backgroundColor: '#dbeafe', borderColor: '#3b82f6' }]}
                activeOpacity={0.85}
                onPress={() => Linking.openURL(`mailto:${form.email}`)}
              >
                <MaterialIcons name="email" size={16} color="#1d4ed8" />
                <Text style={[s.actionPillText, { color: '#1d4ed8' }]}>Email</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Contact */}
        <Text style={s.sectionTitle}>Contact</Text>
        <View style={s.infoCard}>
          {hasContact ? (
            <>
              {fullPhone ? (
                <InfoRow
                  icon="call"
                  label="Phone"
                  value={fullPhone}
                  onPress={() => Linking.openURL(`tel:${form.country_code}${form.phone}`)}
                />
              ) : null}
              {form.email ? (
                <InfoRow
                  icon="email"
                  label="Email"
                  value={form.email}
                  onPress={() => Linking.openURL(`mailto:${form.email}`)}
                  last={!form.website}
                />
              ) : null}
              {form.website ? (
                <InfoRow
                  icon="language"
                  label="Website"
                  value={form.website}
                  onPress={() => {
                    const url = form.website.startsWith('http') ? form.website : `https://${form.website}`;
                    Linking.openURL(url);
                  }}
                  last
                />
              ) : null}
            </>
          ) : (
            <Text style={s.emptyLine}>No contact info</Text>
          )}
        </View>

        {/* Address */}
        <Text style={s.sectionTitle}>Address</Text>
        <View style={s.infoCard}>
          {addressLines.length > 0 ? (
            <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
              <View style={s.infoIconDisk}>
                <MaterialIcons name="place" size={18} color={NAVY} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.infoLabel}>Location</Text>
                {addressLines.map((line, i) => (
                  <Text key={i} style={s.infoValue}>{line}</Text>
                ))}
              </View>
            </View>
          ) : (
            <Text style={s.emptyLine}>No address on file.</Text>
          )}
        </View>

        {/* Other */}
        {hasOther ? (
          <>
            <Text style={s.sectionTitle}>Other</Text>
            <View style={s.infoCard}>
              {form.vat ? <InfoRow icon="badge" label="Tax ID" value={form.vat} last /> : null}
            </View>
          </>
        ) : null}

        {/* ID Proof — read-only in view mode (Replace/Remove are gated
            behind readOnly={true}). Tap Edit to modify. */}
        <Text style={s.sectionTitle}>ID Proof</Text>
        <View style={{ marginBottom: 12 }}>
          <IdProofCards
            front={form.id_proof_front}
            back={form.id_proof_back}
            onChange={setIdProof}
            readOnly
          />
        </View>

        {/* Bottom edit button */}
        <TouchableOpacity
          style={s.editBigBtn}
          activeOpacity={0.85}
          onPress={goToEdit}
        >
          <MaterialIcons name="edit" size={18} color="#fff" />
          <Text style={s.editBigBtnText}>Edit Contact</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // No initial spinner gate — `loading` is only flipped briefly during
  // saves now, and the form is pre-filled from route.params.details.

  return (
    <SafeAreaView backgroundColor="#F5F6FA">
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      {/* Header — Back / Title / Save or Edit (navy bar to match rest of the app) */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.headerBtn}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>
          {isNew ? 'New Contact' : isView ? 'Contact Details' : 'Edit Contact'}
        </Text>
        {isView ? (
          <TouchableOpacity
            onPress={() => navigation.setParams({ mode: 'edit' })}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.headerSaveBtn}>Edit</Text>
          </TouchableOpacity>
        ) : saveOpHidden ? (
          <View style={{ width: 40 }} />
        ) : (
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.headerSaveBtn}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {isView ? renderViewBody() : (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
          {/* Person / Company toggle */}
          <View style={s.toggleRow}>
            <Text style={[s.toggleLabel, !form.is_company && s.toggleLabelActive]}>Person</Text>
            <Switch
              value={form.is_company}
              onValueChange={(v) => set('is_company', v)}
              trackColor={{ false: '#d1d5db', true: NAVY }}
              thumbColor="#fff"
              disabled={isView}
            />
            <Text style={[s.toggleLabel, form.is_company && s.toggleLabelActive]}>Company</Text>
          </View>

          {/* Basic Info */}
          <View style={s.formCard}>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Name *</Text>
              <TextInput
                style={s.fieldInput}
                value={form.name}
                onChangeText={(v) => set('name', v)}
                placeholder={form.is_company ? 'e.g. Lumber Inc' : 'Full Name'}
                placeholderTextColor="#aaa"
                editable={!isView}
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Email</Text>
              <TextInput
                style={s.fieldInput}
                value={form.email}
                onChangeText={(v) => set('email', v)}
                placeholder="Email"
                placeholderTextColor="#aaa"
                editable={!isView}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Phone</Text>
              <View style={s.phoneRow}>
                <TouchableOpacity
                  style={[s.countryCodeBtn, isView && { opacity: 0.6 }]}
                  onPress={() => { if (!isView) setShowCountryPicker(true); }}
                  activeOpacity={0.7}
                  disabled={isView}
                >
                  <Text style={s.countryCodeText}>{form.country_code}{isView ? '' : ' ▾'}</Text>
                </TouchableOpacity>
                <TextInput
                  style={[s.fieldInput, { flex: 1 }]}
                  value={form.phone}
                  onChangeText={(v) => set('phone', v.replace(/[^0-9]/g, ''))}
                  placeholder="Phone number"
                  placeholderTextColor="#aaa"
                editable={!isView}
                  keyboardType="phone-pad"
                  maxLength={getMaxDigits(form.country_code)}
                />
              </View>
              <Text style={s.fieldHint}>
                {`${getMaxDigits(form.country_code)} digits without country code`}
              </Text>
            </View>

            {!form.is_company && (
              <>
                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>Company</Text>
                  <TextInput
                    style={s.fieldInput}
                    value={form.company_name}
                    onChangeText={(v) => set('company_name', v)}
                    placeholder="Company Name…"
                    placeholderTextColor="#aaa"
                editable={!isView}
                  />
                </View>
                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>Job Position</Text>
                  <TextInput
                    style={s.fieldInput}
                    value={form.function}
                    onChangeText={(v) => set('function', v)}
                    placeholder="e.g. Sales Director"
                    placeholderTextColor="#aaa"
                editable={!isView}
                  />
                </View>
              </>
            )}
          </View>

          {/* Address */}
          <Text style={s.sectionTitle}>Address</Text>
          <View style={s.formCard}>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Street</Text>
              <TextInput
                style={s.fieldInput}
                value={form.street}
                onChangeText={(v) => set('street', v)}
                placeholder="Street…"
                placeholderTextColor="#aaa"
                editable={!isView}
              />
            </View>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Street 2</Text>
              <TextInput
                style={s.fieldInput}
                value={form.street2}
                onChangeText={(v) => set('street2', v)}
                placeholder="Street 2…"
                placeholderTextColor="#aaa"
                editable={!isView}
              />
            </View>
            <View style={s.rowFields}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Text style={s.fieldLabel}>City</Text>
                <TextInput
                  style={s.fieldInput}
                  value={form.city}
                  onChangeText={(v) => set('city', v)}
                  placeholder="City"
                  placeholderTextColor="#aaa"
                editable={!isView}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Text style={s.fieldLabel}>ZIP</Text>
                <TextInput
                  style={s.fieldInput}
                  value={form.zip}
                  onChangeText={(v) => set('zip', v)}
                  placeholder="ZIP"
                  placeholderTextColor="#aaa"
                editable={!isView}
                />
              </View>
            </View>
          </View>

          {/* Other */}
          <Text style={s.sectionTitle}>Other</Text>
          <View style={s.formCard}>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Tax ID</Text>
              <TextInput
                style={s.fieldInput}
                value={form.vat}
                onChangeText={(v) => set('vat', v)}
                placeholder="not applicable"
                placeholderTextColor="#aaa"
                editable={!isView}
              />
            </View>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Website</Text>
              <TextInput
                style={s.fieldInput}
                value={form.website}
                onChangeText={(v) => set('website', v)}
                placeholder="e.g. https://www.example.com"
                placeholderTextColor="#aaa"
                editable={!isView}
                keyboardType="url"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* ID Proof — editable in edit/create mode. Cards open the
              Camera/Gallery action sheet on tap; Replace/Remove buttons
              show on filled cards. Saved on the same Save tap below. */}
          <Text style={s.sectionTitle}>ID Proof</Text>
          <View style={{ marginBottom: 14 }}>
            <IdProofCards
              front={form.id_proof_front}
              back={form.id_proof_back}
              onChange={setIdProof}
              readOnly={isView}
              busy={saving}
            />
          </View>

          {/* Save button — hidden in view mode (use the Edit header button instead) */}
          {!isView ? (
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      <CountryCodePicker
        visible={showCountryPicker}
        onClose={() => setShowCountryPicker(false)}
        onSelect={(dial) => set('country_code', dial)}
        selectedDial={form.country_code}
      />
    </SafeAreaView>
  );
};

export default CustomerInfo;

// ─── Styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#fff',
    letterSpacing: 0.3,
  },
  headerBtn: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#fff',
  },
  headerSaveBtn: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#fff',
    letterSpacing: 0.4,
  },

  formContent: { padding: 16, paddingBottom: 60, backgroundColor: '#F5F6FA' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#9ca3af',
  },
  toggleLabelActive: { color: NAVY },

  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },

  fieldGroup: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#6b7280',
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14,
    color: '#1f2937',
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  fieldHint: {
    fontSize: 11,
    color: '#6b7280',
    fontStyle: 'italic',
    marginTop: 4,
    paddingLeft: 2,
  },

  phoneRow: { flexDirection: 'row', gap: 8 },
  countryCodeBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 84,
  },
  countryCodeText: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#1f2937',
  },

  rowFields: { flexDirection: 'row' },

  sectionTitle: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#6b7280',
    marginTop: 18,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  saveBtn: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },

  // ─── View-mode styles ─────────────────────────────────────────
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarInitial: {
    fontSize: 28,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  heroName: {
    fontSize: 20,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.2,
  },
  kindChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0f5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 6,
    gap: 4,
  },
  kindChipText: {
    fontSize: 11,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  heroMuted: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.2,
    gap: 6,
  },
  actionPillText: {
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },

  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#1a1a2e', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F2F6',
  },
  infoIconDisk: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eef0f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  infoLabel: {
    fontSize: 11,
    color: '#8896ab',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  infoValue: {
    fontSize: 14,
    color: '#1a1a2e',
    fontFamily: FONT_FAMILY.urbanistBold,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  emptyLine: {
    fontSize: 13,
    color: '#9ca3af',
    fontFamily: FONT_FAMILY.urbanistMedium,
    fontStyle: 'italic',
    paddingVertical: 14,
    paddingHorizontal: 4,
    textAlign: 'center',
  },

  editBigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
    gap: 8,
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  editBigBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
  },
});

// ─── Country Code Picker styles ──────────────────────────────────
const cs = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  closeBtn: { paddingVertical: 4 },
  closeText: { fontSize: 15, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistBold },
  title: { fontSize: 17, color: '#1f2937', fontFamily: FONT_FAMILY.urbanistBold },
  searchBox: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff' },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14,
    color: '#1f2937',
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  flag: { fontSize: 24 },
  country: { fontSize: 14, color: '#1f2937', fontFamily: FONT_FAMILY.urbanistBold },
  digits: { fontSize: 11, color: '#6b7280', marginTop: 2, fontFamily: FONT_FAMILY.urbanistMedium },
  dial: { fontSize: 14, color: '#374151', fontFamily: FONT_FAMILY.urbanistBold, marginRight: 8 },
  check: { fontSize: 18, color: COLORS.primaryThemeColor, fontFamily: FONT_FAMILY.urbanistBold },
});
