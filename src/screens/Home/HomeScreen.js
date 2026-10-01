import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Image,
  StyleSheet,
  BackHandler,
  ScrollView,
  TouchableOpacity,
  Platform,
  Text,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CarouselPagination } from '@components/Home';
import { RoundedContainer, SafeAreaView } from '@components/containers';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { showToastMessage } from '@components/Toast';
import { useAuthStore } from '@stores/auth';
import { OverlayLoader } from '@components/Loader';
import { useLoader } from '@hooks';
import JournalsTilePopup from '@components/Modal/JournalsTilePopup';
import { version as appVersion } from '../../../package.json';

// Each item carries an optional `featureKey` that, when present, matches a
// record in the Odoo `app.feature` catalog. The render path filters items
// whose featureKey appears in useAuthStore.hiddenFeatures — that's how the
// Privilege Manager dashboard (or in-app App Features admin) hides tiles
// per user. Items without a featureKey are always visible.
//
// The `app_features` admin tile is intentionally featureKey-less so an admin
// can never accidentally lock themselves out of the management screen.
const SECTIONS = [
  {
    title: 'Sales & POS',
    icon: 'point-of-sale',
    accent: '#00BCD4',
    items: [
      { id: 'pos', title: 'POS', screen: 'POSRegister', featureKey: 'home.tile.pos', icon: require('@assets/images/Home/section/possss.png'), bg: '#E0F7FA', accent: '#00BCD4' },
      { id: 'orders', title: 'Orders', screen: 'MyOrdersScreen', icon: require('@assets/images/Home/section/ordersbtnhome.png'), bg: '#E3F2FD', accent: '#2196F3' },
      { id: 'salesreport', title: 'Sales Report', screen: 'SalesReport', featureKey: 'home.tile.sales_report', icon: require('@assets/images/Home/section/salesreportbtn.png'), bg: '#F3E5F5', accent: '#9C27B0' },
    ],
  },
  {
    title: 'Inventory',
    icon: 'inventory-2',
    accent: '#FF9800',
    items: [
      { id: 'products', title: 'Products', screen: 'Products', featureKey: 'home.tile.products', icon: require('@assets/images/Home/section/productsbutton.png'), bg: '#FFF3E0', accent: '#FF9800' },
      { id: 'stock', title: 'Stock', screen: 'StockScreen', featureKey: 'home.tile.stock', icon: require('@assets/images/Home/section/inventory_management.png'), bg: '#FFF3E0', accent: '#FF9800' },
    ],
  },
  {
    title: 'Easy Purchase',
    icon: 'shopping-cart-checkout',
    accent: '#0EA5E9',
    items: [
      { id: 'easy-purchase', title: 'Easy Purchase', screen: 'EasyPurchaseList', featureKey: 'home.tile.easy_purchase', icon: require('@assets/images/Home/section/easypurchase.png'), bg: '#E0F2FE', accent: '#0284C7' },
      { id: 'quick-purchase-return', title: 'Quick Return', screen: 'QuickPurchaseReturnList', featureKey: 'home.tile.quick_purchase_return', icon: require('@assets/images/Home/section/easypurchase.png'), bg: '#FEE2E2', accent: '#B91C1C' },
    ],
  },
  {
    title: 'Contacts',
    icon: 'contacts',
    accent: '#16A34A',
    items: [
      { id: 'customers', title: 'Customers', screen: 'CustomerScreen', featureKey: 'home.tile.customers', icon: require('@assets/images/Home/section/customer.png'), bg: '#DCFCE7', accent: '#16A34A' },
      { id: 'customer-id-proofs', title: 'Customer ID Proofs', screen: 'CustomerIdProofs', featureKey: 'home.tile.customer_id_proofs', icon: 'badge', bg: '#FEF3C7', accent: '#B45309' },
    ],
  },
  {
    title: 'Finance',
    icon: 'account-balance-wallet',
    accent: '#DC2626',
    items: [
      { id: 'expenses', title: 'Expenses', screen: 'ExpensesScreen', featureKey: 'home.tile.expenses', icon: 'receipt-long', bg: '#FEE2E2', accent: '#DC2626' },
    ],
  },
  {
    title: 'Accounting',
    icon: 'account-balance',
    accent: '#7B2D8E',
    items: [
      { id: 'invoices', title: 'Invoices', screen: 'InvoicesListScreen', featureKey: 'home.tile.invoices', icon: 'description', bg: '#E7F1FD', accent: '#1E88E5' },
      { id: 'journal_entries', title: 'Journal Entries', screen: 'JournalEntriesListScreen', featureKey: 'home.tile.journal_entries', icon: 'account-balance', bg: '#F3E5F5', accent: '#7B2D8E' },
      { id: 'partner_ledger', title: 'Partner Ledger', screen: 'PartnerLedgerScreen', featureKey: 'home.tile.partner_ledger', icon: 'people', bg: '#EEF2FF', accent: '#4F46E5' },
      // Not requiresAdmin: salesmen enter the balances; publishing them asks
      // for the admin password.
      { id: 'opening_balance', title: 'Opening Balance', screen: 'OpeningBalanceScreen', featureKey: 'home.tile.opening_balance', icon: 'account-balance-wallet', bg: '#ECFDF5', accent: '#059669' },
    ],
  },
  {
    title: 'Administration',
    icon: 'admin-panel-settings',
    accent: '#9C27B0',
    items: [
      { id: 'users', title: 'Users', screen: 'UsersScreen', featureKey: 'home.tile.users', icon: require('@assets/images/Home/section/userbtnhome.png'), bg: '#F3E5F5', accent: '#9C27B0', requiresAdmin: true },
      { id: 'banners', title: 'App Banners', screen: 'BannersScreen', featureKey: 'home.tile.app_banners', icon: 'image', bg: '#F3E5F5', accent: '#9C27B0', requiresAdmin: true },
      { id: 'app_features', title: 'Apps Privileges', screen: 'AppFeaturesScreen', featureKey: 'home.tile.app_privileges', icon: 'visibility-off', bg: '#F3E5F5', accent: '#9C27B0', requiresAdmin: true },
      { id: 'invoice_settings', title: 'Invoice Settings', screen: 'InvoiceSettingsList', featureKey: 'home.tile.invoice_settings', icon: 'receipt-long', bg: '#F3E5F5', accent: '#9C27B0', requiresAdmin: true },
      { id: 'user_manual', title: 'User Manual', screen: 'UserManual', featureKey: 'home.tile.user_manual', icon: 'menu-book', bg: '#F3E5F5', accent: '#9C27B0', requiresAdmin: true },
      // Module Privileges tile temporarily hidden — uncomment to restore.
      // { id: 'module_privileges', title: 'Module Privileges', screen: 'ModulePrivilegesScreen', icon: 'security', bg: '#F3E5F5', accent: '#9C27B0', requiresAdmin: true },
    ],
  },
];

const padItems = (items, cols = 2) => {
  // Pad to a multiple of `cols` so each row fills out the grid.
  const remainder = items.length % cols;
  if (remainder === 0) return items;
  const padCount = cols - remainder;
  const padded = [...items];
  for (let i = 0; i < padCount; i++) {
    padded.push({ id: `blank-${items[0]?.id || 'x'}-${i}`, empty: true });
  }
  return padded;
};

const HomeScreen = ({ navigation }) => {
  const authUser = useAuthStore((s) => s.user);
  const hiddenFeatures = useAuthStore((s) => s.hiddenFeatures);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [backPressCount, setBackPressCount] = useState(0);
  const [journalsPopupVisible, setJournalsPopupVisible] = useState(false);
  const [detailLoading] = useLoader(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const handleBackPress = useCallback(() => {
    if (navigation.isFocused()) {
      if (backPressCount === 0) {
        setBackPressCount(1);
        return true;
      } else if (backPressCount === 1) {
        BackHandler.exitApp();
      }
    }
    return false;
  }, [backPressCount, navigation]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => backHandler.remove();
  }, [handleBackPress]);

  useEffect(() => {
    const t = setTimeout(() => setBackPressCount(0), 2000);
    return () => clearTimeout(t);
  }, [backPressCount]);

  useEffect(() => {
    if (backPressCount === 1) showToastMessage('Press back again to exit');
  }, [backPressCount]);

  useEffect(() => {
    if (authUser) {
      const uid = authUser.uid || authUser.id || null;
      const uname = authUser.name || authUser.username || authUser.partner_display_name || null;
      console.log('[AUTH] current user id:', uid, 'name:', uname);
    } else {
      console.log('[AUTH] no authenticated user');
    }
  }, [authUser]);

  const handleCardPress = (item) => {
    if (item.requiresAdmin) {
      const isAdmin =
        authUser?.uid === 2 ||
        authUser?.is_admin === true ||
        authUser?.is_superuser === true;
      if (!isAdmin) {
        showToastMessage('Only administrators can access this feature');
        return;
      }
    }
    // Accounting → Journal Entries opens a 2x2 sub-tile popup (Sales /
    // Purchases / Bank & Cash / Miscellaneous) instead of navigating
    // straight to the unfiltered list — mirrors Odoo's backend grouping.
    if (item.id === 'journal_entries') {
      setJournalsPopupVisible(true);
      return;
    }
    navigation.navigate(item.screen, item.params || {});
  };

  const companyName =
    authUser?.company_name ||
    (Array.isArray(authUser?.company_id) ? authUser.company_id[1] : authUser?.company_id) ||
    authUser?.company?.name ||
    null;

  const renderCard = (item, sectionAccent) => {
    if (item.empty) {
      return <View key={item.id} style={[styles.card, styles.cardInvisible]} />;
    }
    // `icon` may be a MaterialIcons name (string) or a require()'d image asset.
    const isImageAsset = typeof item.icon !== 'string';
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => handleCardPress(item)}
      >
        <View style={[styles.cardAccentBar, { backgroundColor: sectionAccent }]} />
        <View style={[styles.iconWrapper, { backgroundColor: item.bg }]}>
          {isImageAsset
            ? <Image source={item.icon} style={styles.cardIcon} resizeMode="contain" />
            : <MaterialIcons name={item.icon} size={26} color={item.accent} />}
        </View>
        <View style={styles.cardTextContainer}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.cardTitle}>
            {item.title}
          </Text>
        </View>
        <MaterialIcons
          name="chevron-right"
          size={20}
          color="#C9CDD6"
          style={styles.cardChevron}
        />
      </TouchableOpacity>
    );
  };

  const renderSection = (section) => {
    // Filter out items whose featureKey is in the user's hidden set. If a
    // section is left with zero visible items, hide the whole section
    // header too — otherwise users see a labelled but empty row.
    const visibleItems = section.items.filter(
      (it) => !it.featureKey || !hiddenFeatures.has(it.featureKey)
    );
    if (visibleItems.length < section.items.length) {
      const hiddenList = section.items
        .filter((it) => it.featureKey && hiddenFeatures.has(it.featureKey))
        .map((it) => it.featureKey);
      console.log(`[FeatureGate] section "${section.title}" filtered out:`, hiddenList);
    }
    if (visibleItems.length === 0) return null;
    return (
      <View key={section.title} style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconWrap, { backgroundColor: section.accent + '20' }]}>
            <MaterialIcons name={section.icon} size={18} color={section.accent} />
          </View>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionCount}>{visibleItems.length}</Text>
        </View>
        <View style={styles.sectionGrid}>
          {padItems(visibleItems, 2).map((item) => renderCard(item, section.accent))}
        </View>
      </View>
    );
  };

return (
    <SafeAreaView backgroundColor={COLORS.primaryThemeColor}>
      <RoundedContainer>
        {/* Company logo */}
        <View style={styles.logoContainer}>
          <Image
            source={require('@assets/images/logo2.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {/* Carousel banner */}
        <CarouselPagination />

        {/* Date & Time pill */}
        <View style={styles.greetingContainer}>
          <MaterialIcons name="calendar-today" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.dateText} numberOfLines={1}>
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
          <View style={styles.timeBadge}>
            <MaterialIcons name="access-time" size={14} color="#fff" />
            <Text style={styles.timeText} numberOfLines={1}>
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </Text>
          </View>
        </View>

        {/* Quick Access header chip */}
        <View style={styles.quickAccessHeader}>
          <View>
            <Text style={styles.quickAccessTitle}>Quick Access</Text>
            <Text style={styles.quickAccessSubtitle}>Manage your store</Text>
          </View>
          {companyName ? (
            <View style={styles.companyBadge}>
              <MaterialIcons name="business" size={14} color="#fff" />
              <Text style={styles.companyBadgeText} numberOfLines={1}>{companyName}</Text>
            </View>
          ) : null}
        </View>

        {/* Grouped sections */}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {SECTIONS.map(renderSection)}
          <Text style={styles.footer}>
            Powered by 369ai  |  v{appVersion}
          </Text>
        </ScrollView>
        <OverlayLoader visible={detailLoading} />
      </RoundedContainer>
      <JournalsTilePopup
        isVisible={journalsPopupVisible}
        onClose={() => setJournalsPopupVisible(false)}
        onPick={({ journalTypes, titleSuffix }) => {
          setJournalsPopupVisible(false);
          navigation.navigate('JournalEntriesListScreen', { journalTypes, titleSuffix });
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 10,
    marginTop: 4,
  },
  logoImage: {
    width: 420,
    height: 156,
  },

  greetingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: '#F5F7FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8ECF0',
    gap: 8,
  },
  dateText: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    color: COLORS.primaryThemeColor,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
    flexShrink: 0,
  },
  timeText: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#fff',
  },

  quickAccessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 10,
    marginHorizontal: 8,
    marginTop: 4,
  },
  quickAccessTitle: {
    fontSize: 18,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#fff',
  },
  quickAccessSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginTop: 2,
  },
  companyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: 160,
  },
  companyBadgeText: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    color: '#fff',
    marginLeft: 4,
  },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 10, paddingBottom: 100, paddingTop: 6 },

  section: { marginTop: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 8,
  },
  sectionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionLine: { flex: 1, height: 1, backgroundColor: '#E8ECF0', marginHorizontal: 6 },
  sectionCount: {
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#888',
    backgroundColor: '#F5F7FA',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 0 },
  // 2-column row tiles. Width math: 47.5% × 2 + 1.25% × 4 margins = 100%.
  card: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    margin: '1.25%',
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingLeft: 0,                  // accent bar handles the left edge
    paddingRight: 10,
    minHeight: 76,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    overflow: 'hidden',              // clip the accent bar to rounded corners
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
    }),
  },
  cardInvisible: { backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0, borderWidth: 0 },
  cardAccentBar: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  iconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardIcon: {
    width: 30,
    height: 30,
  },
  cardTextContainer: {
    flex: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 13,
    textAlign: 'left',
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  cardChevron: { marginLeft: 4 },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: '#B0B0B0',
    marginTop: 16,
    marginBottom: 10,
  },
});

export default HomeScreen;
