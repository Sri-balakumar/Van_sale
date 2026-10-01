// src/navigation/StackNavigator.js

import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AppNavigator from "./AppNavigator";
import { ProductsScreen, SplashScreen, VendingCart, CartScreen } from "@screens";
import { ProductCreationForm } from "@screens/Products";
import { OptionsScreen } from "@screens/Home/Options";
import { VehicleTrackingScreen, VehicleTrackingForm } from "@screens/Home/Options/VehicleTracking";

import { TaskManagerScreen } from "@screens/Home/Options/TaskManager";
import { AuditDetails, AuditForm, AuditScreen } from "@screens/Home/Options/Audit";
import { PrivacyPolicy } from "@screens/Auth";
import LoginScreenOdoo from "@screens/Auth/LoginScreenOdoo";
import DeviceSetupScreen from "@screens/DeviceSetup/DeviceSetupScreen";
import DeviceQRScannerScreen from "@screens/DeviceSetup/DeviceQRScannerScreen";
import CategoriesScreen from "@screens";
import Scanner from "@components/Scanner";
// import Barcode from "@components/Scanner"; // Uncomment and fix if Barcode is a named export or separate file
import SalesOrderChoice from "@screens/Home/Sections/Customer/SalesOrderChoice";
import POSRegister from "@screens/Home/Sections/Customer/POSRegister";
import POSConfigSessions from "@screens/Home/Sections/Customer/POSConfigSessions";
import POSOpenAmount from "@screens/Home/Sections/Customer/POSOpenAmount";
import POSProducts from "@screens/Home/Sections/Customer/POSProducts";
import IcecreamProducts from "@screens/Home/Sections/Customer/IcecreamProducts";
import POSCartSummary from "@screens/Home/Sections/Customer/POSCartSummary";
import POSPayment from "@screens/Home/Sections/Customer/POSPayment";
import TakeoutDelivery from '@screens/Home/Sections/Customer/TakeoutDelivery';
import CreateInvoice from '@screens/Home/Sections/Customer/CreateInvoice';
import CreateInvoicePreview from '@screens/Home/Sections/Customer/CreateInvoicePreview';
import InvoicesListScreen from '../screens/Accounting/InvoicesListScreen';
import JournalEntriesListScreen from '../screens/Accounting/JournalEntriesListScreen';
import PartnerLedgerScreen from '../screens/Accounting/PartnerLedgerScreen';
import { OpeningBalanceScreen } from '../screens/OpeningBalance';
import InvoiceDetailScreen from '../screens/Accounting/InvoiceDetailScreen';
import { InventoryDetails, InventoryForm, InventoryScreen } from "@screens/Home/Options/Inventory";
import { ProductDetail } from "@components/common/Detail";
import {
  CustomerDetails,
  CustomerScreen,
  CustomerInfo,
  CustomerIdProofsScreen,
  CustomerIdProofDetailScreen,
} from "@screens/Home/Sections/Customer";
import { MarketStudyScreen } from "@screens/Home/Options/MarketStudy";
import { EditVisitPlan, VisitPlanForm, VisitsPlanScreen, VisitPlanDetails } from "@screens/Home/Options/VisitsPlan";
import { EditVisit, VisitDetails, VisitScreen } from "@screens/Home/Options/Visits"; //customer visit
import { MapViewScreen } from "@components/MapViewScreen";
import { CRMScreen } from "@screens/Home/Options/CRM";
import { EnquiryRegisterForm, EnquiryRegisterScreen } from "@screens/Home/Options/CRM/EnquiryRegister";
import { CustomerFormTabs } from "@screens/Home/Sections/Customer/CustomerFormTabs";
import { EditLead, LeadForm, LeadScreen } from "@screens/Home/Options/CRM/Leads";
import { EnquiryDetailTabs } from "@screens/Home/Options/CRM/EnquiryRegister/EnquiryDetailTabs";
import { LeadDetailTabs } from "@screens/Home/Options/CRM/Leads/LeadDetailTabs";
import { EditPipeline, PipelineForm, PipelineScreen } from "@screens/Home/Options/CRM/Pipeline";
import { PipelineDetailTabs } from "@screens/Home/Options/CRM/Pipeline/PipelineDetailTabs";
import { BoxInspectionForm, BoxInspectionScreen } from "@screens/Home/Options/BoxInspection";
import { AttendanceScreen } from "@screens/Home/Options/Attendance";
import { MarkAttendance, PunchingScreen } from "@screens/Home/Options/Attendance/Punching";
import { AddParticipants, KPIActionDetails, KPIDashboardScreen, KPIListingScreen } from "@screens/KPIDashboard";
import { ServicesScreen } from "@screens/Home/Sections/Services";
import { ServiceScreens } from "@screens/Home/Sections/Services/Service";
import { SparePartsIssueCreation, SparePartsRequestDetails, SparePartsRequestScreen } from "@screens/Home/Sections/Services/SpareManagements/SparePartsRequest";
import { AddSpareParts, QuickServiceDetails, QuickServiceScreen, QuickServiceUpdateDetails } from "@screens/Home/Sections/Services/Service/QuickService";
import { SpareManagementsScreen } from "@screens/Home/Sections/Services/SpareManagements";
import { QuickServiceFormTabs } from "@screens/Home/Sections/Services/Service/QuickService/QuickServiceFormTabs";
import { EditPickupDetails, PickupDetails, PickupScreen } from "@screens/Home/Sections/Services/Service/Pickup";
import { VisitFormTabs } from "@screens/Home/Options/Visits/VisitFormTabs";
import { PurchasesScreen } from "@screens/Home/Options/Purchases";
import { AddPriceLines, EditPriceEnquiryDetails, PriceEnquiryDetails, PriceEnquiryForm, PriceEnquiryScreen } from "@screens/Home/Options/Purchases/PriceEnquiry";
import { AddProductLines, EditPurchaseRequisitionDetails, PurchaseRequisitionDetails, PurchaseRequisitionForm, PurchaseRequisitionScreen } from "@screens/Home/Options/Purchases/PurchaseRequisition";
import { AddEditPurchaseLines, AddPurchaseLines, EditPurchaseLines, EditPurchaseOrderDetails, PurchaseOrderDetails, PurchaseOrderForm, PurchaseOrderScreen } from "@screens/Home/Options/Purchases/PurchaseOrder";
import { DeliveryNoteCreation, DeliveryNoteDetails, DeliveryNoteScreen } from "@screens/Home/Options/Purchases/DeliveryNote";
import { VendorBillDetails, VendorBillScreen } from "@screens/Home/Options/Purchases/VendorBill";
import { AddVendorProducts, VendorBillFormTabs } from "@screens/Home/Options/Purchases/VendorBill/VendorBillFormTabs";
import { SupplierPaymentCreation, SupplierPaymentScreen } from "@screens/Home/Options/Purchases/SupplierPayment";
// Use the old Icecube invoice/receipt preview as the POS receipt screen
const POSReceiptScreen = CreateInvoicePreview;
import VendingPaymentGateway from '@screens/Home/Sections/Customer/VendingPaymentGateway';
import { UsersScreen, UserDetailsScreen } from '@screens/Users';
import { BannersScreen, BannerDetailsScreen } from '@screens/AppBanners';
import { AppFeaturesScreen, ModulePrivilegesScreen, InvoiceSettingsScreen, InvoiceSettingsListScreen, InvoiceSettingsHubScreen, ReceiptPaperSizesScreen, InvoiceLayoutsScreen, InvoiceLayoutDetailScreen, InvoiceLayoutEditorScreen } from '@screens/Admin';
import UserManualScreen from '@screens/UserManual/UserManualScreen';
import { MyOrdersScreen, OrderDetailScreen } from '@screens/MyOrders';
import { StockScreen, StockDetailScreen } from '@screens/Stock';
import { ExpensesScreen, ExpenseFormScreen, ExpenseDetailScreen } from '@screens/Expenses';
import { SalesReportScreen } from '@screens/SalesReport';
import OrdersAnalysisScreen from '@screens/OrdersAnalysis/OrdersAnalysisScreen';
import {
  EasyPurchaseListScreen,
  EasyPurchaseFormScreen,
  EasyPurchaseDetailScreen,
  PaymentMethodsScreen,
  PaymentMethodFormScreen,
  BarcodePrintScreen,
} from '@screens/EasyPurchase';
import QuickPurchaseReturnListScreen from '../screens/QuickPurchaseReturn/QuickPurchaseReturnListScreen';
import QuickPurchaseReturnFormScreen from '../screens/QuickPurchaseReturn/QuickPurchaseReturnFormScreen';
import QuickPurchaseReturnDetailScreen from '../screens/QuickPurchaseReturn/QuickPurchaseReturnDetailScreen';




const Stack = createNativeStackNavigator();

const StackNavigator = () => {
  // Always boot through Splash. SplashScreen reads `userData` from
  // AsyncStorage and `navigation.reset`s to either AppNavigator (logged in)
  // or LoginScreenOdoo. This guarantees the login screen is never shown
  // again once the user has logged in — only logout / clearing app data
  // routes back to it.
  return (
    <Stack.Navigator initialRouteName="Splash">
      {/* Easy Purchase */}
      <Stack.Screen name="EasyPurchaseList" component={EasyPurchaseListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EasyPurchaseForm" component={EasyPurchaseFormScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EasyPurchaseDetail" component={EasyPurchaseDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="QuickPurchaseReturnList" component={QuickPurchaseReturnListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="QuickPurchaseReturnForm" component={QuickPurchaseReturnFormScreen} options={{ headerShown: false }} />
      <Stack.Screen name="QuickPurchaseReturnDetail" component={QuickPurchaseReturnDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PaymentMethodForm" component={PaymentMethodFormScreen} options={{ headerShown: false }} />
      <Stack.Screen name="BarcodePrint" component={BarcodePrintScreen} options={{ headerShown: false }} />

      <Stack.Screen
        name="SalesOrderChoice"
        component={SalesOrderChoice}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSRegister"
        component={POSRegister}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSConfigSessions"
        component={POSConfigSessions}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSOpenAmount"
        component={POSOpenAmount}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSProducts"
        component={POSProducts}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="IcecreamProducts"
        component={IcecreamProducts}
        options={{ headerShown: false }}
      />
      
      <Stack.Screen
        name="POSCartSummary"
        component={POSCartSummary}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSPayment"
        component={POSPayment}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSReceiptScreen"
        component={POSReceiptScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendingPaymentGateway"
        component={VendingPaymentGateway}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="TakeoutDelivery"
        component={TakeoutDelivery}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CreateInvoice"
        component={CreateInvoice}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CreateInvoicePreview"
        component={CreateInvoicePreview}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoicesListScreen"
        component={InvoicesListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="JournalEntriesListScreen"
        component={JournalEntriesListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PartnerLedgerScreen"
        component={PartnerLedgerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="OpeningBalanceScreen"
        component={OpeningBalanceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceDetailScreen"
        component={InvoiceDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Splash Screen */}
      <Stack.Screen
        name="Splash"
        component={SplashScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Scanner"
        component={Scanner}
        options={{ headerShown: false }}
      />


    

      <Stack.Screen
        name="MapViewScreen"
        component={MapViewScreen}
        options={{ headerShown: false }}
      />
      {/* Device Setup (gating screens — shown before Login on first launch) */}
      <Stack.Screen
        name="DeviceSetup"
        component={DeviceSetupScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeviceQRScanner"
        component={DeviceQRScannerScreen}
        options={{ headerShown: false }}
      />
      {/* Login Screen */}
      <Stack.Screen
        name="LoginScreenOdoo"
        component={LoginScreenOdoo}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicy}
        options={{ headerShown: false }}
      />
      {/* App Navigator - Bottom Tabs */}
      <Stack.Screen
        name="AppNavigator"
        component={AppNavigator}
        options={{ headerShown: false }}
      />
      {/* Options Screen */}
      <Stack.Screen
        name="OptionsScreen"
        component={OptionsScreen}
        options={{ headerShown: false }}
      />
      {/* Vehicle Tracking Screen */}
      <Stack.Screen
        name="VehicleTrackingScreen"
        component={VehicleTrackingScreen}
        options={{ headerShown: false }}
      />
      {/* Vehicle Tracking Form */}
      <Stack.Screen
        name="VehicleTrackingForm"
        component={VehicleTrackingForm}
        options={{ headerShown: false }}
      />
      
      {/* Audit Screen */}
      <Stack.Screen
        name="AuditScreen"
        component={AuditScreen}
        options={{ headerShown: false }}
      />
      {/* Audit Form */}
      <Stack.Screen
        name="AuditForm"
        component={AuditForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AuditDetails"
        component={AuditDetails}
        options={{ headerShown: false }}
      />

      {/* Inventory Screen */}
      <Stack.Screen
        name="InventoryScreen"
        component={InventoryScreen}
        options={{ headerShown: false }}
      />
      {/* Inventory Details */}
      <Stack.Screen
        name="InventoryDetails"
        component={InventoryDetails}
        options={{ headerShown: false }}
      />
      {/* Inventory Form */}
      <Stack.Screen
        name="InventoryForm"
        component={InventoryForm}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="TaskManagerScreen"
        component={TaskManagerScreen}
        options={{ headerShown: false }}
      />
      {/* Products */}
      <Stack.Screen
        name="Products"
        component={ProductsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProductCreationForm"
        component={ProductCreationForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetail}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CartScreen"
        component={CartScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendingCart"
        component={VendingCart}
        options={{ headerShown: false }}
      />
      {/* Customers */}
      <Stack.Screen
        name="CustomerScreen"
        component={CustomerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerDetails"
        component={CustomerDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerInfo"
        component={CustomerInfo}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerIdProofs"
        component={CustomerIdProofsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerIdProofDetail"
        component={CustomerIdProofDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerFormTabs"
        component={CustomerFormTabs}
        options={{ headerShown: false }}
      />

      {/* Service */}
      <Stack.Screen
        name="ServiceScreens"
        component={ServiceScreens}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceUpdateDetails"
        component={QuickServiceUpdateDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddSpareParts"
        component={AddSpareParts}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceDetails"
        component={QuickServiceDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ServicesScreen"
        component={ServicesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceScreen"
        component={QuickServiceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceFormTabs"
        component={QuickServiceFormTabs}
        options={{ headerShown: false }}
      />

      {/* Spare Managements */}
      <Stack.Screen
        name="SparePartsRequestScreen"
        component={SparePartsRequestScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareManagementsScreen"
        component={SpareManagementsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SparePartsIssueCreation"
        component={SparePartsIssueCreation}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SparePartsRequestDetails"
        component={SparePartsRequestDetails}
        options={{ headerShown: false }}
      />

      {/* Market Study */}
      <Stack.Screen
        name="MarketStudyScreen"
        component={MarketStudyScreen}
        options={{ headerShown: false }}
      />

      {/* Visits Plan */}
      <Stack.Screen
        name="VisitsPlanScreen"
        component={VisitsPlanScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitPlanForm"
        component={VisitPlanForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitPlanDetails"
        component={VisitPlanDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditVisitPlan"
        component={EditVisitPlan}
        options={{ headerShown: false }}
      />

      {/* Customer Visits */}
      <Stack.Screen
        name="VisitScreen"
        component={VisitScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitForm"
        component={VisitFormTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitDetails"
        component={VisitDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditVisit"
        component={EditVisit}
        options={{ headerShown: false }}
      />

      {/* CRM */}
      <Stack.Screen
        name="CRM"
        component={CRMScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EnquiryRegisterScreen"
        component={EnquiryRegisterScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EnquiryRegisterForm"
        component={EnquiryRegisterForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EnquiryDetailTabs"
        component={EnquiryDetailTabs}
        options={{ headerShown: false }}
      />

      {/* Leads */}
      <Stack.Screen
        name="LeadScreen"
        component={LeadScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LeadForm"
        component={LeadForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LeadDetailTabs"
        component={LeadDetailTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditLead"
        component={EditLead}
        options={{ headerShown: false }}
      />

      {/* Pipeline */}
      <Stack.Screen
        name="PipelineScreen"
        component={PipelineScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PipelineForm"
        component={PipelineForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PipelineDetailTabs"
        component={PipelineDetailTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPipeline"
        component={EditPipeline}
        options={{ headerShown: false }}
      />

      {/* Pickup */}
      <Stack.Screen
        name="PickupScreen"
        component={PickupScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PickupDetails"
        component={PickupDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPickupDetails"
        component={EditPickupDetails}
        options={{ headerShown: false }}
      />

      {/* BoxInspection */}
      <Stack.Screen
        name="BoxInspectionScreen"
        component={BoxInspectionScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BoxInspectionForm"
        component={BoxInspectionForm}
        options={{ headerShown: false }}
      />

      {/* Attendance */}
      <Stack.Screen
        name="AttendanceScreen"
        component={AttendanceScreen}
        options={{ headerShown: false }}
      />
      {/* Punching */}
      <Stack.Screen
        name="PunchingScreen"
        component={PunchingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MarkAttendance"
        component={MarkAttendance}
        options={{ headerShown: false }}
      />

      {/* KPI */}
      <Stack.Screen
        name="KPIListingScreen"
        component={KPIListingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="KPIDashboardScreen"
        component={KPIDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="KPIActionDetails"
        component={KPIActionDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddParticipants"
        component={AddParticipants}
        options={{ headerShown: false }}
      />

      {/* Purchases */}
      <Stack.Screen
        name="PurchasesScreen"
        component={PurchasesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseRequisitionForm"
        component={PurchaseRequisitionForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseRequisitionScreen"
        component={PurchaseRequisitionScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseRequisitionDetails"
        component={PurchaseRequisitionDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPurchaseRequisitionDetails"
        component={EditPurchaseRequisitionDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddProductLines"
        component={AddProductLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PriceEnquiryForm"
        component={PriceEnquiryForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PriceEnquiryScreen"
        component={PriceEnquiryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PriceEnquiryDetails"
        component={PriceEnquiryDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPriceEnquiryDetails"
        component={EditPriceEnquiryDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddPriceLines"
        component={AddPriceLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseOrderDetails"
        component={PurchaseOrderDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPurchaseOrderDetails"
        component={EditPurchaseOrderDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseOrderForm"
        component={PurchaseOrderForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseOrderScreen"
        component={PurchaseOrderScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddPurchaseLines"
        component={AddPurchaseLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddEditPurchaseLines"
        component={AddEditPurchaseLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPurchaseLines"
        component={EditPurchaseLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNoteScreen"
        component={DeliveryNoteScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNoteCreation"
        component={DeliveryNoteCreation}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNoteDetails"
        component={DeliveryNoteDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendorBillScreen"
        component={VendorBillScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendorBillDetails"
        component={VendorBillDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendorBillFormTabs"
        component={VendorBillFormTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddVendorProducts"
        component={AddVendorProducts}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SupplierPaymentScreen"
        component={SupplierPaymentScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SupplierPaymentCreation"
        component={SupplierPaymentCreation}
        options={{ headerShown: false }}
      />
      {/* Users */}
      <Stack.Screen
        name="UsersScreen"
        component={UsersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="UserDetails"
        component={UserDetailsScreen}
        options={{ headerShown: false }}
      />
      {/* App Banners */}
      <Stack.Screen
        name="BannersScreen"
        component={BannersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BannerDetails"
        component={BannerDetailsScreen}
        options={{ headerShown: false }}
      />
      {/* App Features (privilege gating admin) */}
      <Stack.Screen
        name="AppFeaturesScreen"
        component={AppFeaturesScreen}
        options={{ headerShown: false }}
      />
      {/* Module Privileges (CRUD-per-module admin) */}
      <Stack.Screen
        name="ModulePrivilegesScreen"
        component={ModulePrivilegesScreen}
        options={{ headerShown: false }}
      />
      {/* Dynamic Invoice settings (admin) — list → hub → 3 sub-screens
          (General Settings / Receipt Paper Sizes / Invoice Layouts). */}
      <Stack.Screen
        name="InvoiceSettingsList"
        component={InvoiceSettingsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceSettingsHub"
        component={InvoiceSettingsHubScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceSettings"
        component={InvoiceSettingsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ReceiptPaperSizes"
        component={ReceiptPaperSizesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceLayouts"
        component={InvoiceLayoutsScreen}
        options={{ headerShown: false }}
      />
      {/* Native Invoice Layout detail (blocks) + visual editor (all options). */}
      <Stack.Screen
        name="InvoiceLayoutDetail"
        component={InvoiceLayoutDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceLayoutEditor"
        component={InvoiceLayoutEditorScreen}
        options={{ headerShown: false }}
      />
      {/* User Manual documents (view for all; manage for admins) */}
      <Stack.Screen
        name="UserManual"
        component={UserManualScreen}
        options={{ headerShown: false }}
      />
      {/* Orders */}
      <Stack.Screen
        name="MyOrdersScreen"
        component={MyOrdersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Stock */}
      <Stack.Screen
        name="StockScreen"
        component={StockScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Expenses */}
      <Stack.Screen
        name="ExpensesScreen"
        component={ExpensesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ExpenseForm"
        component={ExpenseFormScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ExpenseDetail"
        component={ExpenseDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Sales Report */}
      <Stack.Screen
        name="SalesReport"
        component={SalesReportScreen}
        options={{ headerShown: false }}
      />
      {/* Orders Analysis */}
      <Stack.Screen
        name="OrdersAnalysis"
        component={OrdersAnalysisScreen}
        options={{ headerShown: false }}
      />
      {/* Tables screen removed for ice cream shop (no table seating) */}
    </Stack.Navigator>
  );
};

export default StackNavigator;
