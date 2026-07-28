import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Platform,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
  Modal,
  FlatList,
  Dimensions,
} from 'react-native';
import RNModal from 'react-native-modal';
import { SafeAreaView } from '@components/containers';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import {
  createProductOdoo,
  updateProductOdoo,
  fetchPosCategoriesOdoo,
  fetchUomsOdoo,
  fetchProductDetailsOdoo,
  createPosCategoryOdoo,
  updatePosCategoryOdoo,
  createUomOdoo,
  updateUomOdoo,
} from '@api/services/generalApi';
import Toast from 'react-native-toast-message';
import { useFeatureHidden } from '@components/FeatureGate';

const NAVY = COLORS.primaryThemeColor;

// "X Dozen Y Pcs" label for a piece count + pack size (mirrors the Odoo module).
const formatDozenLabel = (pieces, pack) => {
  pieces = Math.round(pieces || 0);
  pack = pack || 12;
  const dozens = Math.floor(pieces / pack);
  const loose = pieces % pack;
  const parts = [];
  if (dozens) parts.push(`${dozens} Dozen`);
  if (loose || !dozens) parts.push(`${loose} Pcs`);
  return parts.join(' ');
};
const ORANGE = '#F47B20';
const MUTED = '#9CA3AF';

// Standard 12-slot Odoo kanban palette. Index 0 = "no colour" (white).
const ODOO_COLORS = [
  '#FFFFFF', '#F06050', '#F4A460', '#F7CD1F',
  '#6CC1ED', '#814968', '#EB7E7F', '#2C8397',
  '#475577', '#D6145F', '#30C381', '#9365B8',
];

const ProductCreationForm = ({ navigation, route }) => {
  const editId = route?.params?.productId || null;
  const isEdit = !!editId;
  // Defense-in-depth: even if a user reaches this form, hide Save when the
  // matching App Features key is off for them.
  const isOpHidden = useFeatureHidden(isEdit ? 'products.edit' : 'products.add');

  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(isEdit);
  // Original on-hand qty captured at prefill — used to skip the qty write
  // when the user didn't actually change it. The qty path is the most
  // failure-prone part of the save and we don't want it firing on every save.
  const originalOnHandRef = useRef(null);
  const originalUomRef = useRef(null);
  // Original factor/reference of the unit being edited — so we only write the
  // ratio when it actually changed (Odoo blocks re-writing the ratio of a unit
  // used by moved/reserved products).
  const originalUomFactorRef = useRef('');
  const originalUomRefIdRef = useRef(null);
  // Snapshot of the prefilled form (edit mode) so the Save button only enables
  // once at least one field has actually changed.
  const originalFormRef = useRef(null);

  const [productName, setProductName] = useState('');
  const [salesPrice, setSalesPrice] = useState('');
  const [cost, setCost] = useState('');
  const [onHandQty, setOnHandQty] = useState('');
  const [trackInventory, setTrackInventory] = useState(false); // is_storable
  const [trackConfirmVisible, setTrackConfirmVisible] = useState(false);
  // Dozen Display (product_dozen_display module): show/enter on-hand in dozens.
  const [dozenDisplay, setDozenDisplay] = useState(false);   // use_dozen_display
  const [dozenPackSize, setDozenPackSize] = useState('12');  // dozen_pack_size
  const [dozensInput, setDozensInput] = useState('');        // typed dozens -> onHandQty
  const [dozenConfirmVisible, setDozenConfirmVisible] = useState(false);
  const [dozenPending, setDozenPending] = useState({ old: 0, next: 0 });
  const [barcode, setBarcode] = useState('');
  const [internalRef, setInternalRef] = useState('');

  const [imageUri, setImageUri] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);

  const [posCategories, setPosCategories] = useState([]);
  const [uoms, setUoms] = useState([]);
  // category state holds {id, name, kind: 'internal' | 'pos'} so we know which
  // Odoo field to write on save.
  // POS categories are many2many in Odoo (pos_categ_ids), so the product can
  // belong to several — hold the selection as an array of { id, name }.
  const [selectedCats, setSelectedCats] = useState([]);
  const [uom, setUom] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(null); // 'category' | 'uom' | null
  const [pickerSearch, setPickerSearch] = useState('');

  // Inline "New / Edit Category" mini-form (POS category only).
  const [addCatModalVisible, setAddCatModalVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(0);
  const [creatingCat, setCreatingCat] = useState(false);
  const [editingCatId, setEditingCatId] = useState(null); // null = create mode

  // Inline "New Unit of Measure" mini-form (Odoo 19: name + reference unit + factor).
  const [addUomModalVisible, setAddUomModalVisible] = useState(false);
  const [editingUomId, setEditingUomId] = useState(null); // null = create, id = edit
  const [newUomName, setNewUomName] = useState('');
  const [newUomFactor, setNewUomFactor] = useState('');
  const [newUomGroupPos, setNewUomGroupPos] = useState(false); // is_pos_groupable
  const [newUomRef, setNewUomRef] = useState(null);       // { id, name } reference unit
  const [uomRefPickerVisible, setUomRefPickerVisible] = useState(false);
  const [creatingUom, setCreatingUom] = useState(false);
  const [refSearch, setRefSearch] = useState('');         // search text in the ref picker
  const [refCreateMode, setRefCreateMode] = useState(false); // show "Create Reference Unit" form
  const [newRefName, setNewRefName] = useState('');       // name typed in the create form
  const [creatingRef, setCreatingRef] = useState(false);

  // Load POS-category + UoM lists once.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchPosCategoriesOdoo(),
      fetchUomsOdoo(),
    ]).then(([posCats, us]) => {
      if (!alive) return;
      setPosCategories(posCats || []);
      setUoms(us || []);
    });
    return () => { alive = false; };
  }, []);

  // Edit mode: fetch the product and prefill the form.
  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    fetchProductDetailsOdoo(editId)
      .then((od) => {
        if (!alive || !od) return;
        setProductName(od.product_name || '');
        setSalesPrice(od.sale_price !== undefined && od.sale_price !== null ? String(od.sale_price) : '');
        setCost(od.cost !== undefined && od.cost !== null ? String(od.cost) : '');
        const initialQty = od.total_product_quantity ?? 0;
        setOnHandQty(String(initialQty));
        originalOnHandRef.current = String(initialQty);
        setBarcode(od.barcode || '');
        setInternalRef(od.product_code || '');
        if (od.image_url) setImageUri(od.image_url);
        // Prefill the product's POS categories (many2many). fetchProductDetailsOdoo
        // returns pos_categories (all); fall back to the single pos_category.
        if (Array.isArray(od.pos_categories) && od.pos_categories.length) {
          setSelectedCats(od.pos_categories.map((c) => ({ id: c.id, name: c.name })));
        } else if (od.pos_category?.id) {
          setSelectedCats([{ id: od.pos_category.id, name: od.pos_category.name }]);
        }
        if (od.uom?.uom_id) {
          setUom({ id: od.uom.uom_id, name: od.uom.uom_name });
          originalUomRef.current = od.uom.uom_id;
        }
        const track = !!od.is_storable;
        setTrackInventory(track);
        const dz = !!od.use_dozen_display;
        const pack = String(od.dozen_pack_size || 12);
        setDozenDisplay(dz);
        setDozenPackSize(pack);
        // On Hand (Dozens) input = pieces / pack (products here are Units, factor 1).
        const packN = parseInt(pack, 10) || 12;
        const initQtyN = Number(od.total_product_quantity ?? 0);
        setDozensInput(dz && initQtyN ? String(initQtyN / packN) : '');
        // Snapshot the prefilled values so we can detect edits (dirty state).
        originalFormRef.current = {
          name: (od.product_name || '').trim(),
          salesPrice: od.sale_price != null ? String(od.sale_price) : '',
          cost: od.cost != null ? String(od.cost) : '',
          barcode: od.barcode || '',
          internalRef: od.product_code || '',
          catIds: (Array.isArray(od.pos_categories) ? od.pos_categories.map((c) => c.id)
            : (od.pos_category?.id ? [od.pos_category.id] : [])).slice().sort().join(','),
          trackInventory: track,
          dozenDisplay: dz,
          dozenPackSize: pack,
        };
      })
      .catch(() => {
        Toast.show({ type: 'error', text1: 'Failed to load product', position: 'bottom' });
      })
      .finally(() => alive && setPrefilling(false));
    return () => { alive = false; };
  }, [isEdit, editId]);

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'Permission denied', text2: 'Cannot access photos', position: 'bottom' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      setImageUri(asset.uri);
      setImageBase64(asset.base64 || null);
    } catch (e) {
      console.warn('Image pick failed:', e);
      Toast.show({ type: 'error', text1: 'Could not pick image', position: 'bottom' });
    }
  };

  const handleSubmit = async () => {
    if (!productName.trim()) {
      Toast.show({ type: 'error', text1: 'Product name is required', position: 'bottom' });
      return;
    }
    setSaving(true);
    try {
      // Only push qty when the user actually changed it. Otherwise the
      // stock.quant write fires every save and any failure (e.g. no internal
      // location for this user) gets reported as a partial-save error even
      // though the user didn't touch qty.
      const qtyChanged = isEdit
        ? String(onHandQty || '').trim() !== String(originalOnHandRef.current ?? '').trim()
        : (onHandQty || '') !== '';

      const payload = {
        name: productName.trim(),
        // Multi-select POS categories -> pos_categ_ids (many2many).
        posCategoryIds: selectedCats.map((c) => c.id),
        listPrice: salesPrice,
        standardPrice: cost,
        barcode: barcode || (isEdit ? '' : undefined),
        defaultCode: internalRef || (isEdit ? '' : undefined),
        // In edit mode only send uom_id when it actually changed — writing the
        // same value is a no-op, and writing a changed one on a stocked product
        // is rejected by Odoo (now isolated so it can't drop Cost).
        uomId: isEdit
          ? (uom?.id !== originalUomRef.current ? uom?.id : undefined)
          : uom?.id,
        // In edit mode only send a fresh image when the user picked one
        // (imageBase64 is null when they kept the existing photo).
        image: imageBase64 || undefined,
        onHandQty: qtyChanged ? (onHandQty || '0') : undefined,
        trackInventory,
        useDozenDisplay: dozenDisplay,
        dozenPackSize: dozenDisplay ? dozenPackSize : undefined,
      };
      const resp = isEdit
        ? await updateProductOdoo(editId, payload)
        : await createProductOdoo(payload);
      if (resp?.error) {
        Toast.show({
          type: 'error',
          text1: isEdit ? 'Save failed' : 'Create failed',
          // Odoo's JSON-RPC error puts a generic "Odoo Server Error" in
          // .message and the useful text in .data.message — prefer the latter.
          text2: resp.error.data?.message || resp.error.message || 'Could not save product',
          position: 'bottom',
        });
        return;
      }
      const notSaved = Array.isArray(resp?.notSaved) ? resp.notSaved : [];
      const qtyFailed = resp?.qtySaved === false;
      // notSaved is edit-only (create writes a fresh record with all fields).
      // qtyFailed can fire on both create and edit when the stock.quant
      // path errors — surface it either way so the user knows the qty
      // didn't persist instead of seeing a misleading green toast.
      const hasPartialFailure = notSaved.length > 0 || qtyFailed;

      if (hasPartialFailure) {
        const labels = {
          name: 'Name',
          list_price: 'Sales Price',
          standard_price: 'Cost',
          categ_id: 'Category',
          pos_categ_ids: 'POS Category',
          available_in_pos: 'POS Visibility',
          barcode: 'Barcode',
          default_code: 'Internal Reference',
          uom_id: 'Unit of Measure',
          image_1920: 'Image',
          description_sale: 'Description',
        };
        const reasons = resp?.reasons || {};
        const failed = notSaved.map((k) => labels[k] || k);
        if (qtyFailed) failed.push('On-Hand Qty');
        // Prefer the specific Odoo reason when we have one (e.g. "Unit of
        // Measure can't change — product has stock"); otherwise list the fields.
        const reasonMsgs = [];
        notSaved.forEach((k) => {
          if (reasons[k]) reasonMsgs.push(`${labels[k] || k}: ${reasons[k]}`);
        });
        if (qtyFailed && resp?.qtyError) reasonMsgs.push(`On-Hand Qty: ${resp.qtyError}`);
        Toast.show({
          type: 'error',
          text1: 'Some changes did not save',
          text2: reasonMsgs.length ? reasonMsgs.join('\n') : failed.join(', '),
          position: 'bottom',
          visibilityTime: 6000,
        });
        // Stay on the form so the user can retry — don't navigate away and
        // hide the lost data behind a green toast.
        return;
      }

      Toast.show({
        type: 'success',
        text1: isEdit ? 'Product updated' : 'Product created',
        position: 'bottom',
      });
      if (isEdit) {
        // Land back on ProductDetail with a fresh refreshAt so it re-fetches.
        // Also nudge the parent Products screen via setParams so its
        // useFocusEffect refetches when the user pops back to it.
        const ts = Date.now();
        const parent = navigation.getParent?.();
        try {
          (parent || navigation).setParams?.({ refreshAt: ts });
        } catch (_) {}
        navigation.navigate({ name: 'ProductDetail', params: { refreshAt: ts }, merge: true });
      } else {
        // Pop back to Products and bump refreshAt so its useFocusEffect refetches.
        navigation.navigate({ name: 'Products', params: { refreshAt: Date.now() }, merge: true });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Create failed', text2: e?.message || '', position: 'bottom' });
    } finally {
      setSaving(false);
    }
  };

  const openPicker = (which) => {
    setPickerSearch('');
    setPickerOpen(which);
  };
  const closePicker = () => setPickerOpen(null);
  const onPickerSelect = (item, kind) => {
    if (pickerOpen === 'category') {
      // Toggle multi-select — keep the picker open so several can be chosen.
      setSelectedCats((prev) => (
        prev.some((c) => c.id === item.id)
          ? prev.filter((c) => c.id !== item.id)
          : [...prev, { id: item.id, name: item.name }]
      ));
      return;
    }
    if (pickerOpen === 'uom') {
      setUom(item);
    }
    setPickerOpen(null);
  };
  const pickerTitle = pickerOpen === 'category'
    ? 'Select Category'
    : pickerOpen === 'uom'
      ? 'Select Unit of Measure'
      : '';
  const matchSearch = (it) =>
    !pickerSearch || (it.name || '').toLowerCase().includes(pickerSearch.toLowerCase());
  const filteredPosCategories = posCategories.filter(matchSearch);
  const filteredUoms = uoms.filter(matchSearch);
  // When editing a unit, a reference unit may NOT be the unit itself or any of
  // its descendants — that would make a cycle in Odoo's uom hierarchy
  // (relative_uom_id / parent_store) and raise "Recursion Detected."
  const uomRefDisallowed = (u) => {
    if (!editingUomId) return false;            // only relevant while editing
    if (u.id === editingUomId) return true;     // a unit can't reference itself
    let cur = u;
    let guard = 0;
    while (cur && Array.isArray(cur.relative_uom_id) && guard < 100) {
      const pid = cur.relative_uom_id[0];
      if (pid === editingUomId) return true;    // ...nor any of its descendants
      cur = uoms.find((x) => x.id === pid);
      guard += 1;
    }
    return false;
  };

  const handleSaveNewCategory = async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) {
      Toast.show({ type: 'error', text1: 'Category name is required', position: 'bottom' });
      return;
    }
    setCreatingCat(true);
    try {
      const isEditCat = !!editingCatId;
      const resp = isEditCat
        ? await updatePosCategoryOdoo(editingCatId, { name: trimmed, color: newCatColor })
        : await createPosCategoryOdoo({ name: trimmed, color: newCatColor });
      if (resp?.error) {
        Toast.show({
          type: 'error',
          text1: isEditCat ? 'Could not update category' : 'Could not create category',
          text2: resp.error.message || resp.error.data?.message || '',
          position: 'bottom',
        });
        return;
      }
      // Refetch categories so the change is reflected.
      const cats = await fetchPosCategoriesOdoo();
      setPosCategories(cats || []);
      const targetId = isEditCat ? editingCatId : resp.result;
      const updated = (cats || []).find((c) => c.id === targetId)
        || { id: targetId, name: trimmed, color: newCatColor };
      // Reflect the change in the multi-selection: rename it if already picked,
      // or add a freshly-created one to the selection.
      setSelectedCats((prev) => {
        if (prev.some((c) => c.id === updated.id)) {
          return prev.map((c) => (c.id === updated.id ? { id: updated.id, name: updated.name } : c));
        }
        return isEditCat ? prev : [...prev, { id: updated.id, name: updated.name }];
      });
      setAddCatModalVisible(false);
      setEditingCatId(null);
      setNewCatName('');
      setNewCatColor(0);
      Toast.show({
        type: 'success',
        text1: isEditCat ? 'Category updated' : 'Category created',
        position: 'bottom',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Save failed', text2: e?.message || '', position: 'bottom' });
    } finally {
      setCreatingCat(false);
    }
  };

  const openAddUomModal = () => {
    // Default the reference unit to "Units" when available.
    const unitsUom = uoms.find((u) => (u.name || '').toLowerCase() === 'units') || uoms[0] || null;
    setEditingUomId(null);
    setNewUomName(pickerSearch || '');
    setNewUomFactor('');
    setNewUomGroupPos(false);
    setNewUomRef(unitsUom ? { id: unitsUom.id, name: unitsUom.name } : null);
    setPickerOpen(null);
    setAddUomModalVisible(true);
  };

  // Open the same modal in EDIT mode, prefilled from the tapped unit.
  const openEditUomModal = (item) => {
    setEditingUomId(item.id);
    setNewUomName(item.name || '');
    setNewUomFactor(item.relative_factor != null ? String(item.relative_factor) : '');
    setNewUomGroupPos(!!item.is_pos_groupable);
    setNewUomRef(Array.isArray(item.relative_uom_id)
      ? { id: item.relative_uom_id[0], name: item.relative_uom_id[1] }
      : null);
    originalUomFactorRef.current = item.relative_factor != null ? String(item.relative_factor) : '';
    originalUomRefIdRef.current = Array.isArray(item.relative_uom_id) ? item.relative_uom_id[0] : null;
    setPickerOpen(null);
    setAddUomModalVisible(true);
  };

  const handleSaveNewUom = async () => {
    const trimmed = newUomName.trim();
    if (!trimmed) {
      Toast.show({ type: 'error', text1: 'Unit name is required', position: 'bottom' });
      return;
    }
    setCreatingUom(true);
    try {
      console.log('[UOM] handleSaveNewUom ->', { editingUomId, name: trimmed, ref: newUomRef, factor: newUomFactor });
      let resp;
      if (editingUomId) {
        // Only send the ratio fields when they actually changed — writing the
        // ratio of a unit used by moved/reserved products is rejected by Odoo.
        const editVals = { name: trimmed, isPosGroupable: newUomGroupPos };
        if ((newUomRef?.id || null) !== originalUomRefIdRef.current) editVals.relativeUomId = newUomRef?.id;
        if (newUomFactor !== originalUomFactorRef.current) editVals.relativeFactor = newUomFactor;
        resp = await updateUomOdoo(editingUomId, editVals);
      } else {
        resp = await createUomOdoo({
          name: trimmed,
          relativeUomId: newUomRef?.id,
          relativeFactor: newUomFactor,
          isPosGroupable: newUomGroupPos,
        });
      }
      console.log('[UOM] handleSaveNewUom resp:', resp);
      if (resp?.error) {
        Toast.show({
          type: 'error',
          text1: editingUomId ? 'Could not update unit' : 'Could not create unit',
          text2: resp.error.message || resp.error.data?.message || '',
          position: 'bottom',
        });
        return;
      }
      // Refetch units so the change appears, then preselect it on the product.
      const us = await fetchUomsOdoo();
      setUoms(us || []);
      const targetId = editingUomId || resp.result;
      const saved = (us || []).find((u) => u.id === targetId) || { id: targetId, name: trimmed };
      setUom({ id: saved.id, name: saved.name });
      setAddUomModalVisible(false);
      setEditingUomId(null);
      setNewUomName('');
      setNewUomFactor('');
      Toast.show({ type: 'success', text1: editingUomId ? 'Unit updated' : 'Unit created', position: 'bottom' });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Save failed', text2: e?.message || '', position: 'bottom' });
    } finally {
      setCreatingUom(false);
    }
  };

  // Create a NEW reference (base) unit inline from the ref picker — same as
  // Odoo's "Create" on the Reference Unit field. A base unit has no parent.
  const handleCreateRefUnit = async () => {
    const trimmed = newRefName.trim();
    console.log('[UOM] handleCreateRefUnit (create form), name =', JSON.stringify(trimmed));
    if (!trimmed) {
      Toast.show({ type: 'error', text1: 'Unit name is required', position: 'bottom' });
      return;
    }
    setCreatingRef(true);
    try {
      const resp = await createUomOdoo({ name: trimmed }); // no parent -> base unit (factor 1)
      console.log('[UOM] create reference unit resp:', resp);
      if (resp?.error) {
        Toast.show({
          type: 'error',
          text1: 'Could not create reference unit',
          text2: resp.error.message || resp.error.data?.message || '',
          position: 'bottom',
        });
        return;
      }
      const us = await fetchUomsOdoo();
      setUoms(us || []);
      const newId = resp.result;
      const created = (us || []).find((u) => u.id === newId) || { id: newId, name: trimmed };
      // Select it as the reference and return all the way to the New Unit form.
      setNewUomRef({ id: created.id, name: created.name });
      setNewRefName('');
      setRefSearch('');
      setRefCreateMode(false);
      setUomRefPickerVisible(false);
      Toast.show({ type: 'success', text1: 'Reference unit created', position: 'bottom' });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Save failed', text2: e?.message || '', position: 'bottom' });
    } finally {
      setCreatingRef(false);
    }
  };

  // Track Inventory toggle — confirm before turning OFF when the product still
  // has on-hand stock (>0); no prompt when on-hand is 0/empty or turning ON.
  const toggleTrackInventory = () => {
    if (!trackInventory) { setTrackInventory(true); return; }
    const qty = Number(onHandQty) || 0;
    if (qty > 0) {
      setTrackConfirmVisible(true); // confirm via the styled popup below
      return;
    }
    setTrackInventory(false);
  };

  // On Hand (Dozens): confirm before applying the change to Quantity On Hand
  // (mirrors the web module's "Change On Hand from X to Y?" dialog).
  const handleDozensBlur = () => {
    const pack = parseInt(dozenPackSize, 10) || 12;
    const nextPieces = Math.round((parseFloat(dozensInput) || 0) * pack);
    const oldPieces = Math.round(Number(onHandQty) || 0);
    console.log('[DOZEN] blur dozens=', dozensInput, '| next=', nextPieces, '| old=', oldPieces);
    if (nextPieces === oldPieces) return;
    setDozenPending({ old: oldPieces, next: nextPieces });
    setDozenConfirmVisible(true);
  };
  const confirmDozenChange = () => {
    console.log('[DOZEN] confirmed -> onHandQty =', dozenPending.next);
    setOnHandQty(String(dozenPending.next));
    setDozenConfirmVisible(false);
  };
  const cancelDozenChange = () => {
    const pack = parseInt(dozenPackSize, 10) || 12;
    const oldPieces = Math.round(Number(onHandQty) || 0);
    setDozensInput(oldPieces ? String(oldPieces / pack) : '');
    setDozenConfirmVisible(false);
    console.log('[DOZEN] cancelled, reverted to', oldPieces / pack);
  };

  // Edit mode: the Save button stays disabled/dim until at least one field
  // differs from the prefilled snapshot. Create mode is always enabled.
  const isDirty = !isEdit || !originalFormRef.current || (
    productName.trim() !== originalFormRef.current.name ||
    (salesPrice != null ? String(salesPrice) : '') !== originalFormRef.current.salesPrice ||
    (cost != null ? String(cost) : '') !== originalFormRef.current.cost ||
    (barcode || '') !== originalFormRef.current.barcode ||
    (internalRef || '') !== originalFormRef.current.internalRef ||
    selectedCats.map((c) => c.id).slice().sort().join(',') !== originalFormRef.current.catIds ||
    trackInventory !== originalFormRef.current.trackInventory ||
    dozenDisplay !== originalFormRef.current.dozenDisplay ||
    dozenPackSize !== originalFormRef.current.dozenPackSize ||
    String(onHandQty || '').trim() !== String(originalOnHandRef.current ?? '').trim() ||
    (uom?.id ?? null) !== (originalUomRef.current ?? null) ||
    imageBase64 != null
  );
  const saveDisabled = saving || (isEdit && !isDirty);

  return (
    <SafeAreaView backgroundColor="#F5F6FA">
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.headerBtn}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isEdit ? 'Edit Product' : 'New Product'}</Text>
        {isOpHidden ? (
          <View style={{ width: 40 }} />
        ) : (
          <TouchableOpacity onPress={handleSubmit} disabled={saveDisabled} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[s.headerBtn, saveDisabled && { opacity: 0.4 }]}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
          {/* Image picker */}
          <TouchableOpacity style={s.imagePicker} activeOpacity={0.85} onPress={handlePickImage}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={s.productImage} />
            ) : (
              <View style={s.imagePlaceholder}>
                <MaterialIcons name="add-a-photo" size={32} color={MUTED} />
                <Text style={s.imagePlaceholderText}>Add Image</Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={s.formCard}>
            <Field label="Product Name *" value={productName} onChangeText={setProductName} placeholder="Enter product name" />

            <PickerField
              label="Category *"
              value={selectedCats.map((c) => c.name).join(', ')}
              placeholder="Select categories"
              onPress={() => openPicker('category')}
            />

            <Field label="Sales Price" value={salesPrice} onChangeText={setSalesPrice} placeholder="0.000" keyboardType="numeric" />

            <Field label="Cost" value={cost} onChangeText={setCost} placeholder="0.000" keyboardType="numeric" />

            <PickerField
              label="Unit of Measure"
              value={uom?.name}
              placeholder="Select unit"
              onPress={() => openPicker('uom')}
            />

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}
              activeOpacity={0.7}
              onPress={toggleTrackInventory}
            >
              <MaterialIcons
                name={trackInventory ? 'check-box' : 'check-box-outline-blank'}
                size={22}
                color={trackInventory ? NAVY : MUTED}
              />
              <Text style={{ marginLeft: 8, color: '#1a1a2e', fontFamily: FONT_FAMILY.urbanistSemiBold }}>
                Track Inventory
              </Text>
            </TouchableOpacity>

            {trackInventory ? (
              <>
                <Field label="On Hand Quantity" value={onHandQty} onChangeText={setOnHandQty} placeholder="0" keyboardType="numeric" />

                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}
                  activeOpacity={0.7}
                  onPress={() => setDozenDisplay((v) => !v)}
                >
                  <MaterialIcons
                    name={dozenDisplay ? 'check-box' : 'check-box-outline-blank'}
                    size={22}
                    color={dozenDisplay ? NAVY : MUTED}
                  />
                  <Text style={{ marginLeft: 8, color: '#1a1a2e', fontFamily: FONT_FAMILY.urbanistSemiBold }}>
                    Dozen Display
                  </Text>
                </TouchableOpacity>

                {dozenDisplay ? (
                  <>
                    <Field
                      label="Pieces per Dozen"
                      value={dozenPackSize}
                      onChangeText={setDozenPackSize}
                      placeholder="12"
                      keyboardType="numeric"
                    />
                    <Field
                      label="On Hand (Dozens)"
                      value={dozensInput}
                      onChangeText={setDozensInput}
                      onBlur={handleDozensBlur}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                    <Text style={{ color: MUTED, fontSize: 12, marginTop: -6, marginBottom: 10 }}>
                      = {formatDozenLabel(Math.round((parseFloat(dozensInput) || 0) * (parseInt(dozenPackSize, 10) || 12)), parseInt(dozenPackSize, 10) || 12)}
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}

            <Field
              label="Barcode"
              value={barcode}
              onChangeText={setBarcode}
              placeholder="Enter barcode"
              onScanPress={() =>
                navigation.navigate('Scanner', {
                  onScan: (scanned) => {
                    setBarcode(String(scanned || '').trim());
                    navigation.goBack();
                  },
                })
              }
            />

            <Field label="Internal Reference" value={internalRef} onChangeText={setInternalRef} placeholder="e.g. PROD-001" />
          </View>

          <TouchableOpacity
            style={[s.saveBtn, saveDisabled && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={saveDisabled}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name="check-circle" size={20} color="#fff" />
                <Text style={s.saveBtnText}>{isEdit ? 'Save Changes' : 'Create Product'}</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Picker Modal — centered card */}
      <Modal visible={!!pickerOpen} animationType="fade" transparent onRequestClose={closePicker}>
        <TouchableWithoutFeedback onPress={closePicker}>
          <View style={s.pickerBackdrop}>
            <TouchableWithoutFeedback>
              <View style={s.pickerCard}>
                <View style={s.pickerCardHeader}>
                  <Text style={s.pickerHeaderTitle}>{pickerTitle}</Text>
                  <TouchableOpacity
                    onPress={closePicker}
                    style={s.pickerCloseBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="close" size={20} color="#1a1a2e" />
                  </TouchableOpacity>
                </View>
                <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 }}>
                  <TextInput
                    style={s.pickerSearch}
                    placeholder="Search…"
                    placeholderTextColor={MUTED}
                    value={pickerSearch}
                    onChangeText={setPickerSearch}
                  />
                </View>
                {pickerOpen === 'category' ? (
                  <>
                    <FlatList
                      data={filteredPosCategories}
                      keyExtractor={(item, idx) => `p-${item.id}-${idx}`}
                      keyboardShouldPersistTaps="handled"
                      renderItem={({ item }) => (
                        <View style={s.pickerRowWrap}>
                          <TouchableOpacity
                            style={s.pickerRowMain}
                            activeOpacity={0.7}
                            onPress={() => onPickerSelect(item, 'pos')}
                          >
                            <MaterialIcons
                              name={selectedCats.some((c) => c.id === item.id) ? 'check-box' : 'check-box-outline-blank'}
                              size={20}
                              color={selectedCats.some((c) => c.id === item.id) ? NAVY : MUTED}
                              style={{ marginRight: 6 }}
                            />
                            <View style={[s.colorDot, { backgroundColor: ODOO_COLORS[item.color || 0] || '#FFFFFF' }]} />
                            <Text style={s.pickerRowText} numberOfLines={1}>{item.name}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.pickerEditBtn}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => {
                              setEditingCatId(item.id);
                              setNewCatName(item.name || '');
                              setNewCatColor(item.color || 0);
                              setPickerOpen(null);
                              setAddCatModalVisible(true);
                            }}
                          >
                            <MaterialIcons name="edit" size={16} color={NAVY} />
                          </TouchableOpacity>
                        </View>
                      )}
                      ListEmptyComponent={(
                        <View style={{ padding: 24, alignItems: 'center' }}>
                          <Text style={{ color: MUTED }}>No POS categories</Text>
                        </View>
                      )}
                    />
                    <TouchableOpacity
                      style={s.addCatRow}
                      activeOpacity={0.85}
                      onPress={() => {
                        setEditingCatId(null);
                        setNewCatName(pickerSearch || '');
                        setNewCatColor(0);
                        setPickerOpen(null);
                        setAddCatModalVisible(true);
                      }}
                    >
                      <MaterialIcons name="add-circle" size={20} color={NAVY} />
                      <Text style={s.addCatRowText}>Add Category</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <FlatList
                      data={filteredUoms}
                      keyExtractor={(item, idx) => `${item.id}-${idx}`}
                      keyboardShouldPersistTaps="handled"
                      renderItem={({ item }) => (
                        <View style={s.pickerRowWrap}>
                          <TouchableOpacity
                            style={s.pickerRowMain}
                            activeOpacity={0.7}
                            onPress={() => onPickerSelect(item)}
                          >
                            <Text style={s.pickerRowText} numberOfLines={1}>{item.name}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.pickerEditBtn}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => openEditUomModal(item)}
                          >
                            <MaterialIcons name="edit" size={16} color={NAVY} />
                          </TouchableOpacity>
                        </View>
                      )}
                      ListEmptyComponent={(
                        <View style={{ padding: 24, alignItems: 'center' }}>
                          <Text style={{ color: MUTED }}>No results</Text>
                        </View>
                      )}
                    />
                    <TouchableOpacity
                      style={s.addCatRow}
                      activeOpacity={0.85}
                      onPress={openAddUomModal}
                    >
                      <MaterialIcons name="add-circle" size={20} color={NAVY} />
                      <Text style={s.addCatRowText}>Add Unit</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* New Category Modal — centered card with name input + colour grid */}
      <Modal
        visible={addCatModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => !creatingCat && setAddCatModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => !creatingCat && setAddCatModalVisible(false)}>
          <View style={s.pickerBackdrop}>
            <TouchableWithoutFeedback>
              <View style={[s.pickerCard, { maxWidth: 420, maxHeight: undefined }]}>
                <View style={s.pickerCardHeader}>
                  <Text style={s.pickerHeaderTitle}>{editingCatId ? 'Edit Category' : 'New Category'}</Text>
                  <TouchableOpacity
                    onPress={() => !creatingCat && setAddCatModalVisible(false)}
                    style={s.pickerCloseBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="close" size={20} color="#1a1a2e" />
                  </TouchableOpacity>
                </View>
                <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
                  <Text style={s.fieldLabel}>Category Name *</Text>
                  <TextInput
                    style={s.fieldInput}
                    placeholder="e.g. Soft Drinks"
                    placeholderTextColor="#aaa"
                    value={newCatName}
                    onChangeText={setNewCatName}
                    autoFocus
                  />

                  <Text style={[s.fieldLabel, { marginTop: 12 }]}>Colour</Text>
                  <View style={s.colorGrid}>
                    {ODOO_COLORS.map((hex, idx) => {
                      const selected = newCatColor === idx;
                      const isWhite = idx === 0;
                      return (
                        <TouchableOpacity
                          key={idx}
                          activeOpacity={0.85}
                          onPress={() => setNewCatColor(idx)}
                          style={[
                            s.colorSwatch,
                            { backgroundColor: hex },
                            isWhite && { borderColor: '#cbd5e1', borderWidth: 1.5 },
                            selected && !isWhite && { borderColor: '#1a1a2e', borderWidth: 3 },
                            selected && isWhite && { borderColor: NAVY, borderWidth: 2 },
                          ]}
                        >
                          {selected ? (
                            <MaterialIcons
                              name="check"
                              size={16}
                              color={isWhite ? NAVY : '#fff'}
                            />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={s.addCatActions}>
                  <TouchableOpacity
                    style={s.addCatCancelBtn}
                    activeOpacity={0.7}
                    disabled={creatingCat}
                    onPress={() => setAddCatModalVisible(false)}
                  >
                    <Text style={s.addCatCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.addCatSaveBtn, creatingCat && { opacity: 0.6 }]}
                    activeOpacity={0.85}
                    disabled={creatingCat}
                    onPress={handleSaveNewCategory}
                  >
                    {creatingCat ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={s.addCatSaveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* New Unit of Measure Modal — form, or an INLINE reference-unit picker in
          the SAME modal. Stacking two RN <Modal>s breaks touches on Android, so
          the reference list is toggled inside this one modal via uomRefPickerVisible. */}
      <Modal
        visible={addUomModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => {
          if (creatingUom || creatingRef) return;
          if (refCreateMode) { setRefCreateMode(false); return; }
          if (uomRefPickerVisible) { setUomRefPickerVisible(false); return; }
          setAddUomModalVisible(false);
        }}
      >
        <TouchableWithoutFeedback
          onPress={() => {
            if (creatingUom || creatingRef) return;
            if (refCreateMode) { setRefCreateMode(false); return; }
            if (uomRefPickerVisible) { setUomRefPickerVisible(false); return; }
            setAddUomModalVisible(false);
          }}
        >
          <View style={s.pickerBackdrop}>
            <TouchableWithoutFeedback>
              <View style={[s.pickerCard, { maxWidth: 420, maxHeight: undefined }]}>
                {refCreateMode ? (
                  <>
                    <View style={s.pickerCardHeader}>
                      <TouchableOpacity
                        onPress={() => !creatingRef && setRefCreateMode(false)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={{ marginRight: 8 }}
                      >
                        <MaterialIcons name="arrow-back" size={20} color="#1a1a2e" />
                      </TouchableOpacity>
                      <Text style={[s.pickerHeaderTitle, { flex: 1 }]}>Create Reference Unit</Text>
                    </View>
                    <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
                      <Text style={s.fieldLabel}>Unit Name *</Text>
                      <TextInput
                        style={s.fieldInput}
                        placeholder="e.g. Bun"
                        placeholderTextColor="#aaa"
                        value={newRefName}
                        onChangeText={setNewRefName}
                        autoFocus
                      />
                      <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
                        Creates a new base unit that other units can reference.
                      </Text>
                    </View>
                    <View style={s.addCatActions}>
                      <TouchableOpacity
                        style={s.addCatCancelBtn}
                        activeOpacity={0.7}
                        disabled={creatingRef}
                        onPress={() => setRefCreateMode(false)}
                      >
                        <Text style={s.addCatCancelText}>Discard</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.addCatSaveBtn, creatingRef && { opacity: 0.6 }]}
                        activeOpacity={0.85}
                        disabled={creatingRef}
                        onPress={handleCreateRefUnit}
                      >
                        {creatingRef ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={s.addCatSaveText}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : uomRefPickerVisible ? (
                  <>
                    <View style={s.pickerCardHeader}>
                      <TouchableOpacity
                        onPress={() => setUomRefPickerVisible(false)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={{ marginRight: 8 }}
                      >
                        <MaterialIcons name="arrow-back" size={20} color="#1a1a2e" />
                      </TouchableOpacity>
                      <Text style={[s.pickerHeaderTitle, { flex: 1 }]}>Select Reference Unit</Text>
                    </View>
                    <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 }}>
                      <TextInput
                        style={s.pickerSearch}
                        placeholder="Type a name to search or create…"
                        placeholderTextColor={MUTED}
                        value={refSearch}
                        onChangeText={setRefSearch}
                        autoFocus
                      />
                      <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
                        Pick an existing unit below, or tap “Create Reference Unit”.
                      </Text>
                    </View>
                    <FlatList
                      data={uoms.filter((u) => {
                        if (uomRefDisallowed(u)) return false;
                        return !refSearch || (u.name || '').toLowerCase().includes(refSearch.toLowerCase());
                      })}
                      keyExtractor={(item, idx) => `ref-${item.id}-${idx}`}
                      keyboardShouldPersistTaps="handled"
                      style={{ maxHeight: 240 }}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={s.pickerRow}
                          activeOpacity={0.7}
                          onPress={() => {
                            setNewUomRef({ id: item.id, name: item.name });
                            setRefSearch('');
                            setUomRefPickerVisible(false);
                          }}
                        >
                          <Text style={s.pickerRowText}>{item.name}</Text>
                        </TouchableOpacity>
                      )}
                      ListEmptyComponent={(
                        <View style={{ padding: 24, alignItems: 'center' }}>
                          <Text style={{ color: MUTED }}>No units</Text>
                        </View>
                      )}
                    />
                    <TouchableOpacity
                      style={s.addCatRow}
                      activeOpacity={0.85}
                      onPress={() => { setNewRefName(refSearch.trim()); setRefCreateMode(true); }}
                    >
                      <MaterialIcons name="add-circle" size={20} color={NAVY} />
                      <Text style={s.addCatRowText}>Create Reference Unit</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <View style={s.pickerCardHeader}>
                      <Text style={s.pickerHeaderTitle}>{editingUomId ? 'Edit Unit of Measure' : 'New Unit of Measure'}</Text>
                      <TouchableOpacity
                        onPress={() => !creatingUom && setAddUomModalVisible(false)}
                        style={s.pickerCloseBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialIcons name="close" size={20} color="#1a1a2e" />
                      </TouchableOpacity>
                    </View>
                    <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
                      <Text style={s.fieldLabel}>Unit Name *</Text>
                      <TextInput
                        style={s.fieldInput}
                        placeholder="e.g. Pack of 20"
                        placeholderTextColor="#aaa"
                        value={newUomName}
                        onChangeText={setNewUomName}
                        autoFocus
                      />

                      <Text style={[s.fieldLabel, { marginTop: 12 }]}>Reference Unit</Text>
                      <TouchableOpacity
                        style={[s.fieldInput, { justifyContent: 'center' }]}
                        activeOpacity={0.7}
                        onPress={() => { setRefSearch(''); setUomRefPickerVisible(true); }}
                      >
                        <Text style={{ color: newUomRef ? '#1a1a2e' : '#aaa' }}>
                          {newUomRef?.name || 'Select reference unit'}
                        </Text>
                      </TouchableOpacity>

                      <Text style={[s.fieldLabel, { marginTop: 12 }]}>
                        Contains (how many {newUomRef?.name || 'reference units'})
                      </Text>
                      <TextInput
                        style={s.fieldInput}
                        placeholder="e.g. 20"
                        placeholderTextColor="#aaa"
                        value={newUomFactor}
                        onChangeText={setNewUomFactor}
                        keyboardType="numeric"
                        selectTextOnFocus
                      />
                      <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
                        1 {newUomName || 'unit'} = {newUomFactor || '?'} {newUomRef?.name || 'reference units'}
                      </Text>

                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}
                        activeOpacity={0.7}
                        onPress={() => setNewUomGroupPos((v) => !v)}
                      >
                        <MaterialIcons
                          name={newUomGroupPos ? 'check-box' : 'check-box-outline-blank'}
                          size={22}
                          color={newUomGroupPos ? NAVY : MUTED}
                        />
                        <Text style={{ marginLeft: 8, color: '#1a1a2e' }}>Group Products in POS</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={s.addCatActions}>
                      <TouchableOpacity
                        style={s.addCatCancelBtn}
                        activeOpacity={0.7}
                        disabled={creatingUom}
                        onPress={() => setAddUomModalVisible(false)}
                      >
                        <Text style={s.addCatCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.addCatSaveBtn, creatingUom && { opacity: 0.6 }]}
                        activeOpacity={0.85}
                        disabled={creatingUom}
                        onPress={handleSaveNewUom}
                      >
                        {creatingUom ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={s.addCatSaveText}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Disable Track Inventory confirmation — styled like the logout popup. */}
      <RNModal
        isVisible={trackConfirmVisible}
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropOpacity={0.7}
        animationInTiming={400}
        animationOutTiming={300}
        backdropTransitionInTiming={400}
        backdropTransitionOutTiming={300}
        onBackButtonPress={() => setTrackConfirmVisible(false)}
        onBackdropPress={() => setTrackConfirmVisible(false)}
      >
        <View style={s.confirmContainer}>
          <Text style={s.confirmText}>
            This product still has {onHandQty} on hand. Disable Track Inventory?
          </Text>
          <View style={s.confirmButtonRow}>
            <TouchableOpacity
              style={[s.confirmButton, { flex: 1 }]}
              onPress={() => { setTrackInventory(false); setTrackConfirmVisible(false); }}
            >
              <Text style={s.confirmButtonText}>YES</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmButton, { flex: 1 }]}
              onPress={() => setTrackConfirmVisible(false)}
            >
              <Text style={s.confirmButtonText}>NO</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>

      {/* On Hand (Dozens) change confirmation — logout-style popup. */}
      <RNModal
        isVisible={dozenConfirmVisible}
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropOpacity={0.7}
        animationInTiming={400}
        animationOutTiming={300}
        onBackButtonPress={cancelDozenChange}
        onBackdropPress={cancelDozenChange}
      >
        <View style={s.confirmContainer}>
          <Text style={s.confirmText}>
            Change On Hand from {dozenPending.old} to {dozenPending.next} pieces?
          </Text>
          <View style={s.confirmButtonRow}>
            <TouchableOpacity style={[s.confirmButton, { flex: 1 }]} onPress={confirmDozenChange}>
              <Text style={s.confirmButtonText}>YES</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.confirmButton, { flex: 1 }]} onPress={cancelDozenChange}>
              <Text style={s.confirmButtonText}>NO</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>
    </SafeAreaView>
  );
};

const Field = ({ label, value, onChangeText, placeholder, keyboardType, multiline, onScanPress, onBlur }) => {
  // Numeric / phone inputs auto-select on tap so the user can overwrite the
  // existing value with a fresh number in one tap.
  const isNumeric = keyboardType === 'numeric' || keyboardType === 'phone-pad' || keyboardType === 'decimal-pad';
  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      {onScanPress ? (
        <View style={s.scanRow}>
          <TextInput
            style={[s.fieldInput, { flex: 1 }]}
            value={value}
            onChangeText={onChangeText}
            onBlur={onBlur}
            placeholder={placeholder}
            placeholderTextColor="#aaa"
            keyboardType={keyboardType || 'default'}
            selectTextOnFocus={isNumeric}
          />
          <TouchableOpacity
            style={s.scanBtn}
            activeOpacity={0.85}
            onPress={onScanPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="qr-code-scanner" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <TextInput
          style={[s.fieldInput, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor="#aaa"
          keyboardType={keyboardType || 'default'}
          multiline={!!multiline}
          selectTextOnFocus={isNumeric}
        />
      )}
    </View>
  );
};

const PickerField = ({ label, value, placeholder, onPress }) => (
  <View style={s.fieldGroup}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TouchableOpacity style={s.pickerBtn} activeOpacity={0.75} onPress={onPress}>
      <Text style={[s.pickerBtnText, !value && { color: '#aaa' }]} numberOfLines={1}>
        {value || placeholder}
      </Text>
      <MaterialIcons name="arrow-drop-down" size={22} color={MUTED} />
    </TouchableOpacity>
  </View>
);

export default ProductCreationForm;

const s = StyleSheet.create({
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
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  headerBtn: {
    fontSize: 15,
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  formContent: { padding: 16, paddingBottom: 60, backgroundColor: '#F5F6FA' },

  imagePicker: { alignItems: 'center', marginVertical: 8 },
  productImage: { width: 130, height: 130, borderRadius: 14, backgroundColor: '#eee' },
  imagePlaceholder: {
    width: 130, height: 130, borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#e5e7eb', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  imagePlaceholderText: { fontSize: 12, color: MUTED, marginTop: 4, fontFamily: FONT_FAMILY.urbanistMedium },

  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    marginBottom: 4,
  },

  fieldGroup: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 12, color: '#6b7280',
    fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: '#fff',
    borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14, color: '#1f2937',
    fontFamily: FONT_FAMILY.urbanistMedium,
  },

  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  pickerBtnText: { fontSize: 14, color: '#1f2937', fontFamily: FONT_FAMILY.urbanistMedium, flex: 1 },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, borderRadius: 12,
    paddingVertical: 16, marginTop: 20, marginBottom: 20, gap: 8,
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },

  // Track-Inventory confirmation popup — mirrors LogoutModal's look.
  confirmContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderColor: COLORS.primaryThemeColor,
    borderWidth: 2,
    paddingVertical: 22,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  confirmText: {
    marginVertical: 18,
    fontSize: 16,
    textAlign: 'center',
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  confirmButton: {
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 10,
    padding: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 5,
  },
  confirmButtonText: {
    color: 'white',
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: Math.min(Dimensions.get('window').height * 0.78, 560),
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 14 },
    }),
  },
  pickerCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#eef0f5',
  },
  pickerCloseBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#f3f4f6',
    alignItems: 'center', justifyContent: 'center',
  },
  pickerHeaderTitle: { fontSize: 16, color: '#1a1a2e', fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.2 },
  pickerSearch: {
    backgroundColor: '#F3F4F6', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 14, color: '#1f2937', fontFamily: FONT_FAMILY.urbanistMedium,
  },
  pickerRow: {
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
    flexDirection: 'row', alignItems: 'center',
  },
  pickerRowText: { fontSize: 14, color: '#1f2937', fontFamily: FONT_FAMILY.urbanistMedium, flexShrink: 1 },
  // Two-column row used for category list (name on left, edit pencil on right).
  pickerRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  pickerRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  pickerEditBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eef0f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: '#F5F6FA',
  },
  pickerSectionTitle: {
    fontSize: 11,
    color: '#6b7280',
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Picker row colour dot — small swatch matching the POS category's color.
  colorDot: {
    width: 10, height: 10, borderRadius: 5,
    marginRight: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
  },

  // "+ Add Category" footer inside the picker popup
  addCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 8,
  },
  addCatRowText: {
    fontSize: 14,
    color: NAVY,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },

  // New-Category modal — name + colour swatches
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 6,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCatActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
  },
  addCatCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCatCancelText: {
    color: NAVY,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  addCatSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
    }),
  },
  addCatSaveText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.4,
  },
});
