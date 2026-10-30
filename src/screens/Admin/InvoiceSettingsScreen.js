// In-app admin editor for the dynamic POS invoice settings. Reads/writes the
// SAME Odoo `pos.invoice.settings` record the Odoo backend "Invoice Settings"
// edits, so a change here is identical to one made in Odoo web. Admin-only
// (same guard shape as AppFeaturesScreen). Includes the "Use Dynamic Invoice
// on App" master switch, all branding fields, logo upload, show/hide toggles
// and the bilingual Terms & Conditions list.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Switch, Image, Platform, FlatList,
} from 'react-native';
import Modal from 'react-native-modal';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { showToastMessage } from '@components/Toast';
import { useAuthStore } from '@stores/auth';
import { fetchInvoiceSettings, saveInvoiceSettings, fetchInvoiceCompanies, fetchInvoiceLogo, fetchDynamicReceiptHtml, fetchOrdersOdoo, fetchPaperSizes } from '@api/services/generalApi';
import { WebView } from 'react-native-webview';

const NAVY = COLORS.primaryThemeColor;
const ORANGE = '#F47B20';

// Receipt sizes are no longer hardcoded here — they're per-company
// `pos.invoice.paper.size` records, managed on the Receipt Paper Sizes screen.
// This screen only PICKS which one is the default (default_paper_size_id).

const InvoiceSettingsScreen = ({ navigation, route }) => {
  const recordId = route?.params?.id || null;
  const isNew = !!route?.params?.isNew;
  const authUser = useAuthStore((s) => s.user);
  const companyProfile = useAuthStore((s) => s.companyProfile);

  const [isAdmin, setIsAdmin] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [saving, setSaving] = useState(false);
  // Unsaved-changes guard.
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const savedSnapRef = useRef(null);   // snapshot at load / after save
  const curSnapRef = useRef('');       // latest snapshot (updated each render)
  const pendingLeaveRef = useRef(null); // the nav action to replay on Discard
  const leavingRef = useRef(false);    // bypass the guard once Discard confirmed

  const [id, setId] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [companyLabel, setCompanyLabel] = useState('');
  const [companies, setCompanies] = useState([]);
  const [companyPickerVisible, setCompanyPickerVisible] = useState(false);
  const [existingLogoB64, setExistingLogoB64] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  // Scalar fields
  // 3-way template: 'html' (built-in) | 'dynamic' (branded) | 'cash_memo'.
  const [invoiceTemplate, setInvoiceTemplate] = useState('html');
  // Cash Memo header (bilingual Oman invoice).
  const [companyNameAr, setCompanyNameAr] = useState('');
  const [companyNameEn, setCompanyNameEn] = useState('');
  const [crNumber, setCrNumber] = useState('');
  const [poBox, setPoBox] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [gsm, setGsm] = useState('');
  const [vatNo, setVatNo] = useState('');
  // Per-field show/hide toggles for the Cash Memo header.
  const [showCmName, setShowCmName] = useState(true);
  const [showCmCr, setShowCmCr] = useState(true);
  const [showCmPobox, setShowCmPobox] = useState(true);
  const [showCmPostal, setShowCmPostal] = useState(true);
  const [showCmSultanate, setShowCmSultanate] = useState(true);
  const [showCmGsm, setShowCmGsm] = useState(true);
  const [showCmVat, setShowCmVat] = useState(true);
  // Per-field show/hide toggles for the Dynamic invoice header (share the same
  // company_name_ar / cr_number / gsm / vat_number values as the Cash Memo).
  const [showDynCr, setShowDynCr] = useState(true);
  const [showDynGsm, setShowDynGsm] = useState(true);
  const [showDynSultanate, setShowDynSultanate] = useState(true);
  const [showDynVat, setShowDynVat] = useState(true);
  const [showDynNameAr, setShowDynNameAr] = useState(true);
  // Dynamic invoice customer lines: off = name + mobile, on = also address /
  // VAT / email. `null` = the server module is too old to have the setting,
  // so the switch is hidden and never sent.
  const [showDynCustomerDetails, setShowDynCustomerDetails] = useState(null);
  // Preview modal
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [showLogo, setShowLogo] = useState(true);
  const [headerTitle, setHeaderTitle] = useState('');
  const [footerText, setFooterText] = useState('');
  const [showTax, setShowTax] = useState(true);
  const [showCustomerSig, setShowCustomerSig] = useState(true);
  const [showCashierSig, setShowCashierSig] = useState(true);
  const [showFooter, setShowFooter] = useState(true);

  // Default receipt size (per-company). Applies to every template: when on, the
  // app skips its size prompt and prints at the linked paper size.
  const [useDefaultSize, setUseDefaultSize] = useState(false);
  // The default receipt size now LINKS to a pos.invoice.paper.size record.
  // defaultSizeId = record id (saved as default_paper_size_id); paperSizes = the
  // company's sizes, fetched for the picker. Sizes are edited on the separate
  // Receipt Paper Sizes screen.
  const [defaultSizeId, setDefaultSizeId] = useState(null);
  const [defaultSizeLabel, setDefaultSizeLabel] = useState('');
  const [paperSizes, setPaperSizes] = useState([]);
  const [sizePickerVisible, setSizePickerVisible] = useState(false);

  // Logo edit state: pickedLogoUri (local preview) + logoBase64
  //   undefined = leave unchanged, false = clear, string = new base64.
  const [pickedLogoUri, setPickedLogoUri] = useState(null);
  const [logoBase64, setLogoBase64] = useState(undefined);

  // Admin guard — same shape as AppFeaturesScreen.
  useEffect(() => {
    const ok = authUser?.uid === 2 || authUser?.is_admin === true || authUser?.is_superuser === true;
    setIsAdmin(ok);
    if (!ok) {
      showToastMessage('Only administrators can access Invoice Settings');
      setTimeout(() => navigation.goBack(), 1500);
    }
  }, [authUser, navigation]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        console.log('[InvoiceSettings] open — mode=' + (isNew ? 'NEW(create)' : (recordId ? ('EDIT id=' + recordId) : 'EDIT(current company)')));
        if (isNew) {
          // Blank create form (like Odoo "New"): no company preselected — the
          // admin must pick one from the dropdown; no existing record loaded.
          const rows = await fetchInvoiceCompanies();
          setCompanies(rows || []);
          setId(null);
          setCompanyId(null);
          setCompanyLabel('');
          setInvoiceTemplate('html');
          setHeaderTitle('INVOICE / فاتورة');
          setFooterText('Thank you for your purchase!\nشكرا لشرائك!');
          return;
        }
        const s = await fetchInvoiceSettings(recordId);
        if (!s) {
          showToastMessage('Dynamic Invoice module is not installed on the server');
          setTimeout(() => navigation.goBack(), 1500);
          return;
        }
        setId(s.id);
        const recCompany = Array.isArray(s.company_id) ? s.company_id[1] : '';
        setCompanyId(Array.isArray(s.company_id) ? s.company_id[0] : null);
        setCompanyLabel(recCompany);
        fetchInvoiceCompanies().then((rows) => setCompanies(rows || [])).catch(() => {});
        fetchInvoiceLogo(s.id).then((b64) => setExistingLogoB64(b64)).catch(() => {});
        // 3-way template — fall back for older records that only had the boolean.
        setInvoiceTemplate(s.invoice_template || (s.use_dynamic_invoice ? 'dynamic' : 'html'));
        setCompanyNameAr(s.company_name_ar || '');
        setCompanyNameEn(s.company_name_en || '');
        setCrNumber(s.cr_number || '');
        setPoBox(s.po_box || '');
        setPostalCode(s.postal_code || '');
        setGsm(s.gsm || '');
        setVatNo(s.vat_no || '');
        setShowCmName(s.show_cm_name !== false);
        setShowCmCr(s.show_cm_cr !== false);
        setShowCmPobox(s.show_cm_pobox !== false);
        setShowCmPostal(s.show_cm_postal !== false);
        setShowCmSultanate(s.show_cm_sultanate !== false);
        setShowCmGsm(s.show_cm_gsm !== false);
        setShowCmVat(s.show_cm_vat !== false);
        setShowDynCr(s.show_dyn_cr !== false);
        setShowDynGsm(s.show_dyn_gsm !== false);
        setShowDynSultanate(s.show_dyn_sultanate !== false);
        setShowDynVat(s.show_dyn_vat !== false);
        setShowDynNameAr(s.show_dyn_name_ar !== false);
        setShowDynCustomerDetails('show_dyn_customer_details' in s ? !!s.show_dyn_customer_details : null);
        setAddress(s.address || '');
        setPhone(s.phone || '');
        setEmail(s.email || '');
        setVatNumber(s.vat_number || '');
        setShowLogo(s.show_logo !== false);
        setHeaderTitle(s.header_title || '');
        setFooterText(s.footer_text || '');
        setShowTax(s.show_tax !== false);
        setShowCustomerSig(s.show_customer_signature !== false);
        setShowCashierSig(s.show_shop_owner_signature !== false);
        setShowFooter(s.show_footer !== false);
        setUseDefaultSize(!!s.use_default_paper_size);
        setDefaultSizeId(s.default_paper_size_id || null);
        setDefaultSizeLabel(s.default_paper_size_label || '');
        // Paper sizes for this company feed the default-size picker (managed on
        // the Receipt Paper Sizes screen). Exclude the internal `custom` record.
        const companyIdForSizes = Array.isArray(s.company_id) ? s.company_id[0] : null;
        fetchPaperSizes(companyIdForSizes)
          .then((rows) => setPaperSizes((rows || []).filter((r) => !r.is_custom)))
          .catch(() => {});
      } catch (e) {
        console.error('[InvoiceSettings] bootstrap', e);
        showToastMessage(e?.message || 'Failed to load settings');
      } finally {
        setBootstrapping(false);
      }
    })();
  }, [isAdmin, navigation]);

  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showToastMessage('Photo permission is needed to pick a logo'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8, base64: true, allowsEditing: true,
      });
      if (res.canceled) return;
      const asset = res.assets && res.assets[0];
      if (!asset?.base64) { showToastMessage('Could not read the selected image'); return; }
      setPickedLogoUri(asset.uri);
      setLogoBase64(asset.base64);
    } catch (e) {
      console.error('[InvoiceSettings] pickLogo', e);
      showToastMessage('Failed to pick image');
    }
  };

  const clearLogo = () => {
    setPickedLogoUri(null);
    setLogoBase64(false); // false → clear on save
  };

  // The write() payload — shared by Save and Preview (Preview persists first so
  // the server renders the picked template with the current form values).
  const buildVals = () => ({
    ...(companyId ? { company_id: companyId } : {}),
    // Server syncs use_dynamic_invoice from invoice_template on write.
    invoice_template: invoiceTemplate,
    company_name_ar: companyNameAr || false,
    company_name_en: companyNameEn || false,
    cr_number: crNumber || false,
    po_box: poBox || false,
    postal_code: postalCode || false,
    gsm: gsm || false,
    vat_no: vatNo || false,
    show_cm_name: !!showCmName,
    show_cm_cr: !!showCmCr,
    show_cm_pobox: !!showCmPobox,
    show_cm_postal: !!showCmPostal,
    show_cm_sultanate: !!showCmSultanate,
    show_cm_gsm: !!showCmGsm,
    show_cm_vat: !!showCmVat,
    show_dyn_cr: !!showDynCr,
    show_dyn_gsm: !!showDynGsm,
    show_dyn_sultanate: !!showDynSultanate,
    show_dyn_vat: !!showDynVat,
    show_dyn_name_ar: !!showDynNameAr,
    ...(showDynCustomerDetails !== null ? { show_dyn_customer_details: !!showDynCustomerDetails } : {}),
    address: address || false,
    phone: phone || false,
    email: email || false,
    vat_number: vatNumber || false,
    show_logo: !!showLogo,
    header_title: headerTitle || false,
    footer_text: footerText || false,
    show_tax: !!showTax,
    show_customer_signature: !!showCustomerSig,
    show_shop_owner_signature: !!showCashierSig,
    show_footer: !!showFooter,
    use_default_paper_size: !!useDefaultSize,
    // Links to a pos.invoice.paper.size record; false clears it.
    default_paper_size_id: defaultSizeId || false,
  });

  // Snapshot of all editable values (+ a logo-change marker) for the
  // unsaved-changes guard. Recomputed every render so the guard always sees the
  // latest state.
  curSnapRef.current = JSON.stringify(buildVals())
    + '|' + (logoBase64 === undefined ? 'u' : logoBase64 === false ? 'f' : 's');

  // Capture the baseline once loading finishes (state is settled by then).
  useEffect(() => {
    if (!bootstrapping && savedSnapRef.current === null) {
      savedSnapRef.current = curSnapRef.current;
      console.log('[InvoiceSettings] baseline snapshot captured (len=' + curSnapRef.current.length + ')');
    }
  }, [bootstrapping]);

  // Intercept leaving (header back / hardware back) when there are unsaved
  // edits: block the navigation and ask Stay / Discard.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (leavingRef.current) { console.log('[InvoiceSettings] leave: discard confirmed → allow'); return; }
      if (savedSnapRef.current === null) { console.log('[InvoiceSettings] leave: not loaded → allow'); return; }
      const dirty = curSnapRef.current !== savedSnapRef.current;
      console.log('[InvoiceSettings] leave attempt — dirty=' + dirty);
      if (!dirty) return;
      e.preventDefault();
      pendingLeaveRef.current = e.data.action;
      setLeaveConfirm(true);
    });
    return unsub;
  }, [navigation]);

  const persistSettings = async () => {
    const savedId = await saveInvoiceSettings({
      id,
      vals: buildVals(),
      logoBase64, // undefined = unchanged, false = clear, string = new
    });
    if (savedId) {
      setId(savedId);
      // A logo just written is now stored — stop re-sending it on the next save.
      if (typeof logoBase64 === 'string') setLogoBase64(undefined);
    }
    try { useAuthStore.getState().refreshDynamicInvoiceFlag?.(); } catch (_) {}
    return savedId;
  };

  // Render the picked template server-side against a real recent order and show
  // it in a WebView. Saves the current form first so the preview is accurate.
  const onPreview = async () => {
    if (!companyId) { setErrorMsg('Please select a company first.'); return; }
    if (invoiceTemplate === 'html') {
      setErrorMsg('Preview is available for Dynamic and Cash Memo templates. Standard uses the app\'s built-in receipt.');
      return;
    }
    setPreviewLoading(true);
    try {
      await persistSettings();
      const orders = await fetchOrdersOdoo({ limit: 1, configId: null });
      const sample = Array.isArray(orders) && orders[0] ? orders[0] : null;
      if (!sample) {
        setErrorMsg('No orders found to preview. Make a sale first, then preview.');
        return;
      }
      // Preview at the chosen default size (else A4 when no default set).
      const sel = paperSizes.find((p) => p.id === defaultSizeId);
      const widthMm = (!useDefaultSize || !sel) ? '210' : String(sel.width_mm || 210);
      const heightMm = (useDefaultSize && sel && sel.height_mm) ? Number(sel.height_mm) : 0;
      const html = await fetchDynamicReceiptHtml({ orderId: sample.id, paperWidthMm: widthMm, paperHeightMm: heightMm });
      if (!html) { setErrorMsg('Could not render a preview for this template.'); return; }
      setPreviewHtml(html);
    } catch (e) {
      console.error('[InvoiceSettings] preview', e);
      setErrorMsg(e?.message || 'Failed to build preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const onSave = async () => {
    if (!companyId) { setErrorMsg('Please select a company first.'); return; }
    setSaving(true);
    try {
      console.log('[InvoiceSettings] save — mode=' + (id ? ('write id=' + id) : 'create') + ' companyId=' + companyId + ' template=' + invoiceTemplate);
      const savedId = await persistSettings();
      console.log('[InvoiceSettings] saved -> id=', savedId);
      showToastMessage('Invoice settings saved');
      savedSnapRef.current = curSnapRef.current; // now clean — don't trigger the guard
      navigation.goBack();
    } catch (e) {
      console.error('[InvoiceSettings] save', e);
      // Show the Odoo message (e.g. the "one record per company" constraint) in
      // a popup matching the logout style, instead of a transient toast.
      setErrorMsg(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView backgroundColor={NAVY}>
        <NavigationHeader title="Invoice Settings" onBackPress={() => navigation.goBack()} />
        <View style={styles.center}><Text style={styles.muted}>Access denied</Text></View>
      </SafeAreaView>
    );
  }

  if (bootstrapping) {
    return (
      <SafeAreaView backgroundColor={NAVY}>
        <NavigationHeader title="Invoice Settings" onBackPress={() => navigation.goBack()} />
        <View style={styles.center}><ActivityIndicator size="large" color={ORANGE} /></View>
      </SafeAreaView>
    );
  }

  // Show the freshly picked image; else the stored logo as a base64 data URI
  // (renders reliably in RN, unlike /web/image which needs the session cookie).
  const showExisting = logoBase64 === undefined && !pickedLogoUri;
  const previewSource = pickedLogoUri
    ? { uri: pickedLogoUri }
    : (showExisting && existingLogoB64 ? { uri: `data:image/png;base64,${existingLogoB64}` } : null);

  // Label for a paper-size record, e.g. "3.5 inch (80 mm)".
  const paperSizeLabel = (p) => {
    if (!p) return '';
    const h = p.height_mm ? ` × ${p.height_mm}` : '';
    return `${p.name} (${p.width_mm}${h} mm)`;
  };

  const Row = ({ label, help, value, onValueChange }) => (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {help ? <Text style={styles.toggleHelp}>{help}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: ORANGE }} />
    </View>
  );

  return (
    <SafeAreaView backgroundColor={NAVY}>
      <NavigationHeader
        title={isNew ? 'New Invoice Settings' : 'General Settings'}
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, paddingBottom: 110 }}>

        {/* Invoice template picker — one control, three receipts. */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Invoice Template</Text>
          <Text style={styles.toggleHelp}>Choose which receipt the app shows.</Text>
          {[
            { key: 'html', title: 'Standard', desc: 'The app\'s built-in receipt.' },
            { key: 'dynamic', title: 'Dynamic', desc: 'Branded receipt — logo, GST, custom header/footer.' },
            { key: 'cash_memo', title: 'Cash Memo', desc: 'Bilingual (English/Arabic) Oman-style A4/A5 invoice.' },
            { key: 'layout', title: 'Custom Layout (editable)', desc: 'Drag-&-drop block layout, designed per size in Odoo → Invoice Layouts.' },
          ].map((opt) => {
            const active = invoiceTemplate === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                activeOpacity={0.8}
                style={[styles.templateOption, active && styles.templateOptionActive]}
                onPress={() => setInvoiceTemplate(opt.key)}
              >
                <MaterialIcons
                  name={active ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={22}
                  color={active ? ORANGE : '#b6bcc8'}
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.templateTitle, active && { color: NAVY }]}>{opt.title}</Text>
                  <Text style={styles.toggleHelp}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          {invoiceTemplate !== 'html' ? (
            <TouchableOpacity
              style={[styles.previewBtn, previewLoading && { opacity: 0.6 }]}
              disabled={previewLoading}
              onPress={onPreview}
            >
              {previewLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <MaterialIcons name="visibility" size={18} color="#fff" />
                  <Text style={styles.previewBtnText}>Preview</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Company — always visible (a settings record is one-per-company, so
            every template needs it before Save). */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Company</Text>
          <TouchableOpacity style={[styles.picker, { marginTop: 6 }]} onPress={() => setCompanyPickerVisible(true)}>
            <Text style={styles.pickerValue}>{companyLabel || 'Select company'}</Text>
            <MaterialIcons name="arrow-drop-down" size={22} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Receipt Size — ALWAYS visible (applies to both the dynamic and the
            normal receipt). When on, the app skips its size prompt on
            Preview / Download / Print and prints at the chosen size. */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.sectionTitle}>Use Default Receipt Size</Text>
              <Text style={styles.toggleHelp}>
                On → Preview, Download and Print use the size below without asking each time.
                Off → the app asks for a size each time.
              </Text>
            </View>
            <Switch value={useDefaultSize} onValueChange={setUseDefaultSize} trackColor={{ true: ORANGE }} />
          </View>
          {useDefaultSize ? (
            <>
              <Text style={[styles.label, { marginTop: 8 }]}>Default Size</Text>
              <TouchableOpacity style={styles.picker} onPress={() => setSizePickerVisible(true)}>
                <Text style={styles.pickerValue}>
                  {(defaultSizeId && paperSizeLabel(paperSizes.find((p) => p.id === defaultSizeId)))
                    || defaultSizeLabel || 'Select size'}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={22} color="#666" />
              </TouchableOpacity>
              <Text style={styles.toggleHelp}>
                Add or edit the available sizes (widths) on the Receipt Paper Sizes screen.
              </Text>
            </>
          ) : null}
        </View>

        {invoiceTemplate === 'html' ? (
          <View style={styles.card}>
            <Text style={styles.toggleHelp}>
              Standard shows the app's built-in receipt — there's nothing extra to configure here.
              Pick <Text style={{ fontFamily: FONT_FAMILY.urbanistBold }}>Dynamic</Text> or{' '}
              <Text style={{ fontFamily: FONT_FAMILY.urbanistBold }}>Cash Memo</Text> above to design a custom invoice.
            </Text>
          </View>
        ) : invoiceTemplate === 'cash_memo' ? (
        <>
        {/* Cash Memo header (bilingual Oman invoice) */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Cash Memo Header</Text>
          <Text style={styles.hint}>These appear on the bilingual invoice header. Leave blank to hide a line.</Text>

          <Text style={styles.label}>Company Name (English)</Text>
          <TextInput style={styles.input} value={companyNameEn} onChangeText={setCompanyNameEn} placeholder="Defaults to the company name" placeholderTextColor="#999" />

          <Text style={styles.label}>Company Name (Arabic)</Text>
          <TextInput style={styles.input} value={companyNameAr} onChangeText={setCompanyNameAr} placeholder="اسم الشركة" placeholderTextColor="#999" textAlign="right" />
          <Row label="Show Company Name" help="Shows/hides both the English and Arabic company name." value={showCmName} onValueChange={setShowCmName} />

          <Text style={styles.label}>C.R. Number</Text>
          <TextInput style={styles.input} value={crNumber} onChangeText={setCrNumber} placeholder="e.g. 1410246" placeholderTextColor="#999" />
          <Row label="Show C.R. Number" value={showCmCr} onValueChange={setShowCmCr} />

          <Text style={styles.label}>GSM / Mobile</Text>
          <TextInput style={styles.input} value={gsm} onChangeText={setGsm} placeholder="e.g. 77576196" placeholderTextColor="#999" keyboardType="phone-pad" />
          <Row label="Show GSM / Mobile" value={showCmGsm} onValueChange={setShowCmGsm} />

          <Row label="Show Sultanate of Oman" value={showCmSultanate} onValueChange={setShowCmSultanate} />

          <Text style={styles.label}>VAT Number</Text>
          <TextInput style={styles.input} value={vatNo} onChangeText={setVatNo} placeholder="e.g. OM1100000000" placeholderTextColor="#999" />
          <Row label="Show VAT Number" value={showCmVat} onValueChange={setShowCmVat} />
        </View>

        {/* Logo — shared with the dynamic receipt */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Logo</Text>
          <View style={styles.logoRow}>
            <View style={styles.logoPreview}>
              {previewSource ? (
                <Image source={previewSource} style={styles.logoImg} resizeMode="contain" />
              ) : (
                <MaterialIcons name="image" size={40} color="#c7ccd6" />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <TouchableOpacity style={styles.smallBtn} onPress={pickLogo}>
                <MaterialIcons name="photo-library" size={18} color="#fff" />
                <Text style={styles.smallBtnText}>Change logo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={clearLogo}>
                <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
                <Text style={[styles.smallBtnText, { color: '#dc2626' }]}>Remove logo</Text>
              </TouchableOpacity>
              <Text style={styles.toggleHelp}>Any image; it's auto-resized for the receipt.</Text>
            </View>
          </View>
          <Row label="Show logo on invoice" value={showLogo} onValueChange={setShowLogo} />
        </View>
        </>
        ) : (
        <>
        {invoiceTemplate === 'layout' ? (
          <View style={[styles.card, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
            <Text style={styles.sectionTitle}>Custom Layout</Text>
            <Text style={styles.toggleHelp}>
              The receipt is built from the drag-&-drop block layout designed per paper size.
              Design blocks (and grid placement) in Odoo → Point of Sale → Invoice Settings →
              Invoice Layouts, or open the Invoice Layouts screen to preview each size. The
              branding, logo and header details below feed the layout's blocks.
            </Text>
          </View>
        ) : null}
        {/* Branding */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Branding</Text>
          <Text style={styles.hint}>Blank fields fall back to the company's own details.</Text>

          <Text style={styles.label}>Address</Text>
          <TextInput style={[styles.input, styles.multiline]} value={address} onChangeText={setAddress} placeholder="One line per row" placeholderTextColor="#999" multiline />

          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Defaults to company phone" placeholderTextColor="#999" />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Defaults to company email" placeholderTextColor="#999" keyboardType="email-address" autoCapitalize="none" />

          <Text style={styles.label}>VAT / GST Number</Text>
          <TextInput style={styles.input} value={vatNumber} onChangeText={setVatNumber} placeholder="e.g. 3001234567890" placeholderTextColor="#999" />
          <Row label="Show VAT / GST line" value={showDynVat} onValueChange={setShowDynVat} />

          {/* Header info lines shared with the Cash Memo (same
              company_name_ar / cr_number / gsm values), each independently
              toggleable on the Dynamic invoice header. */}
          <Text style={styles.label}>Company Name (Arabic)</Text>
          <TextInput style={styles.input} value={companyNameAr} onChangeText={setCompanyNameAr} placeholder="اسم الشركة" placeholderTextColor="#999" textAlign="right" />
          <Row label="Show Arabic company name" value={showDynNameAr} onValueChange={setShowDynNameAr} />

          <Text style={styles.label}>C.R. Number</Text>
          <TextInput style={styles.input} value={crNumber} onChangeText={setCrNumber} placeholder="e.g. 1410246" placeholderTextColor="#999" />
          <Row label="Show C.R. Number" value={showDynCr} onValueChange={setShowDynCr} />

          <Text style={styles.label}>GSM / Mobile</Text>
          <TextInput style={styles.input} value={gsm} onChangeText={setGsm} placeholder="e.g. 77576196" placeholderTextColor="#999" keyboardType="phone-pad" />
          <Row label="Show GSM / Mobile" value={showDynGsm} onValueChange={setShowDynGsm} />

          <Row label="Show Sultanate of Oman" value={showDynSultanate} onValueChange={setShowDynSultanate} />

          {showDynCustomerDetails !== null ? (
            <>
              <Row label="Show full customer details" value={showDynCustomerDetails} onValueChange={setShowDynCustomerDetails} />
              <Text style={styles.toggleHelp}>Off: customer name and mobile only. On: also address, VAT number and email.</Text>
            </>
          ) : null}
        </View>

        {/* Logo */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Logo</Text>
          <View style={styles.logoRow}>
            <View style={styles.logoPreview}>
              {previewSource ? (
                <Image source={previewSource} style={styles.logoImg} resizeMode="contain" />
              ) : (
                <MaterialIcons name="image" size={40} color="#c7ccd6" />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <TouchableOpacity style={styles.smallBtn} onPress={pickLogo}>
                <MaterialIcons name="photo-library" size={18} color="#fff" />
                <Text style={styles.smallBtnText}>Change logo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={clearLogo}>
                <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
                <Text style={[styles.smallBtnText, { color: '#dc2626' }]}>Remove logo</Text>
              </TouchableOpacity>
              <Text style={styles.toggleHelp}>Any image; it's auto-resized for the receipt.</Text>
            </View>
          </View>
          <Row label="Show logo on receipt" value={showLogo} onValueChange={setShowLogo} />
        </View>

        {/* Header & footer */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Header &amp; Footer</Text>
          <Text style={styles.label}>Header Title</Text>
          <TextInput style={styles.input} value={headerTitle} onChangeText={setHeaderTitle} placeholder="INVOICE / فاتورة" placeholderTextColor="#999" />
          <Text style={styles.label}>Footer Text</Text>
          <TextInput style={[styles.input, styles.multiline]} value={footerText} onChangeText={setFooterText} placeholder="Thank you for your purchase!" placeholderTextColor="#999" multiline />
        </View>

        {/* Show/hide toggles */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Show / Hide on Receipt</Text>
          <Row label="Tax row" value={showTax} onValueChange={setShowTax} />
          <Row label="Customer signature" value={showCustomerSig} onValueChange={setShowCustomerSig} />
          <Row label="Cashier signature" value={showCashierSig} onValueChange={setShowCashierSig} />
          <Row label="Footer" value={showFooter} onValueChange={setShowFooter} />
        </View>
        </>
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={[styles.btn, styles.btnConfirm, saving && { opacity: 0.6 }]} disabled={saving} onPress={onSave}>
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <MaterialIcons name="check" size={20} color="#fff" />
              <Text style={styles.btnConfirmText}>Save Settings</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        isVisible={!!errorMsg}
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropOpacity={0.7}
        onBackButtonPress={() => setErrorMsg(null)}
        onBackdropPress={() => setErrorMsg(null)}
      >
        <View style={styles.alertContainer}>
          <Text style={styles.alertText}>{errorMsg}</Text>
          <TouchableOpacity style={[styles.alertButton, { minWidth: 120 }]} onPress={() => setErrorMsg(null)}>
            <Text style={styles.alertButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Default receipt size picker — lists this company's paper-size records
          (managed on the Receipt Paper Sizes screen). */}
      <Modal
        isVisible={sizePickerVisible}
        animationIn="zoomIn"
        animationOut="zoomOut"
        backdropOpacity={0.4}
        onBackdropPress={() => setSizePickerVisible(false)}
        onBackButtonPress={() => setSizePickerVisible(false)}
        style={styles.modalCenter}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Default Size</Text>
            <TouchableOpacity onPress={() => setSizePickerVisible(false)} style={styles.modalCloseBtn}>
              <MaterialIcons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={paperSizes}
            keyExtractor={(it) => `ps-${it.id}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => { setDefaultSizeId(item.id); setDefaultSizeLabel(paperSizeLabel(item)); setSizePickerVisible(false); }}
              >
                <Text style={styles.pickerRowText}>{paperSizeLabel(item)}</Text>
                {defaultSizeId === item.id ? <MaterialIcons name="check" size={20} color={ORANGE} /> : null}
              </TouchableOpacity>
            )}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.emptyPicker}>No sizes yet — add them on the Receipt Paper Sizes screen.</Text>}
          />
        </View>
      </Modal>

      {/* Unsaved-changes guard on leaving */}
      <Modal
        isVisible={leaveConfirm}
        animationIn="zoomIn"
        animationOut="zoomOut"
        backdropOpacity={0.6}
        onBackButtonPress={() => setLeaveConfirm(false)}
        onBackdropPress={() => setLeaveConfirm(false)}
      >
        <View style={styles.alertContainer}>
          <Text style={styles.alertText}>You have unsaved changes. Leave without saving?</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[styles.alertButton, { backgroundColor: '#e5e7eb', minWidth: 110 }]}
              onPress={() => { console.log('[InvoiceSettings] leave: user chose Stay'); setLeaveConfirm(false); }}
            >
              <Text style={[styles.alertButtonText, { color: '#111827' }]}>Stay</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.alertButton, { backgroundColor: '#dc2626', minWidth: 110 }]}
              onPress={() => {
                console.log('[InvoiceSettings] leave: user chose Discard');
                setLeaveConfirm(false);
                leavingRef.current = true;
                if (pendingLeaveRef.current) navigation.dispatch(pendingLeaveRef.current);
              }}
            >
              <Text style={styles.alertButtonText}>Discard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invoice preview */}
      <Modal
        isVisible={!!previewHtml}
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropOpacity={0.6}
        style={{ margin: 0, justifyContent: 'flex-end' }}
        onBackButtonPress={() => setPreviewHtml('')}
        onBackdropPress={() => setPreviewHtml('')}
      >
        <View style={styles.previewSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invoice Preview</Text>
            <TouchableOpacity onPress={() => setPreviewHtml('')} style={styles.modalCloseBtn}>
              <MaterialIcons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>
          <WebView
            originWhitelist={['*']}
            source={{ html: previewHtml || '<html><body></body></html>' }}
            style={{ flex: 1, backgroundColor: '#e9ecf2' }}
            scalesPageToFit
            startInLoadingState
            renderLoading={() => (
              <View style={styles.center}><ActivityIndicator size="large" color={ORANGE} /></View>
            )}
          />
        </View>
      </Modal>

      <Modal
        isVisible={companyPickerVisible}
        animationIn="zoomIn"
        animationOut="zoomOut"
        backdropOpacity={0.4}
        onBackdropPress={() => setCompanyPickerVisible(false)}
        onBackButtonPress={() => setCompanyPickerVisible(false)}
        style={styles.modalCenter}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Company</Text>
            <TouchableOpacity onPress={() => setCompanyPickerVisible(false)} style={styles.modalCloseBtn}>
              <MaterialIcons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={companies}
            keyExtractor={(it) => `co-${it.id}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => { setCompanyId(item.id); setCompanyLabel(item.name); setCompanyPickerVisible(false); }}
              >
                <Text style={styles.pickerRowText}>{item.name}</Text>
                {companyId === item.id ? <MaterialIcons name="check" size={20} color={ORANGE} /> : null}
              </TouchableOpacity>
            )}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.emptyPicker}>No companies found</Text>}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  muted: { color: '#8896ab', fontFamily: FONT_FAMILY.urbanistMedium },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#eef0f4',
  },
  readonly: { fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold, marginTop: 2 },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: '#fff',
  },
  pickerValue: { flex: 1, fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold },
  modalCenter: { margin: 24, justifyContent: 'center', alignItems: 'center' },
  modalCard: {
    width: '100%', maxHeight: 420, backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', paddingBottom: 8,
    ...Platform.select({ android: { elevation: 10 }, ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12 } }),
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  modalTitle: { fontSize: 17, fontFamily: FONT_FAMILY.urbanistBold, color: NAVY, flex: 1 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f2f2f2', alignItems: 'center', justifyContent: 'center' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f5f5f8' },
  pickerRowText: { fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold },
  emptyPicker: { textAlign: 'center', padding: 30, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium },
  // Logout-style alert popup (for the one-per-company constraint message)
  alertContainer: {
    backgroundColor: '#fff', borderRadius: 10, borderColor: NAVY, borderWidth: 2,
    paddingVertical: 22, paddingHorizontal: 14, alignItems: 'center',
  },
  alertText: { marginVertical: 18, fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, textAlign: 'center', color: '#111827' },
  alertButton: { backgroundColor: NAVY, borderRadius: 10, padding: 15, justifyContent: 'center', alignItems: 'center' },
  alertButtonText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold },
  sectionTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: NAVY, marginBottom: 4 },
  templateOption: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, marginTop: 8, backgroundColor: '#fff',
  },
  templateOptionActive: { borderColor: ORANGE, backgroundColor: '#fff7ed' },
  templateTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#374151' },
  previewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 12, marginTop: 12,
  },
  previewBtnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14, marginLeft: 6 },
  previewSheet: { height: '88%', backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  hint: { fontSize: 11, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: 6 },
  label: { fontSize: 12, color: '#6b7280', fontFamily: FONT_FAMILY.urbanistSemiBold, marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistMedium, backgroundColor: '#fff',
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  sliderHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  sliderVal: { fontSize: 13, color: NAVY, fontFamily: FONT_FAMILY.urbanistBold },
  sliderInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sizeInput: {
    width: 74, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center',
    fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold, backgroundColor: '#fff',
  },
  sizeHint: { fontSize: 12, color: ORANGE, fontFamily: FONT_FAMILY.urbanistBold, marginTop: 8 },
  presetHelp: { fontSize: 11, color: '#dc2626', fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: 4, lineHeight: 15 },
  presetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f1f2f6',
  },
  presetRowLabel: { fontSize: 13, color: '#374151', fontFamily: FONT_FAMILY.urbanistSemiBold },
  presetInput: {
    width: 74, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center',
    fontSize: 14, color: '#111827', fontFamily: FONT_FAMILY.urbanistSemiBold, backgroundColor: '#fff',
  },
  presetAllowed: { fontSize: 10, color: '#dc2626', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 3 },
  presetResetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1, borderColor: '#fecaca', borderRadius: 8, paddingVertical: 9, marginTop: 12,
  },
  presetResetText: { color: '#dc2626', fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 4 },
  sizeChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 2 },
  sizeChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff',
  },
  sizeChipActive: { borderColor: ORANGE, backgroundColor: '#fff7ed' },
  sizeChipText: { fontSize: 12, color: '#374151', fontFamily: FONT_FAMILY.urbanistSemiBold },
  sizeChipTextActive: { color: NAVY },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f2f6', marginTop: 6,
  },
  toggleLabel: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#374151' },
  toggleHelp: { fontSize: 11, color: '#9ca3af', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 2 },
  logoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  logoPreview: {
    width: 84, height: 84, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafbfc', overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 8,
  },
  smallBtnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#fecaca' },
  smallBtnText: { color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  addBtnText: { color: ORANGE, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 2 },
  termRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  termDelete: { marginLeft: 8, marginTop: 8, padding: 4 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
  },
  btn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  btnConfirm: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOpacity: 0.32, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  btnConfirmText: { color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 4 },
});

export default InvoiceSettingsScreen;
