# NEXGENN Van Sale

> A van-sales POS on Odoo — sell off the vehicle, print a branded receipt, buy stock back in,
> and keep the books straight, all from the phone in the driver's hand.

NEXGENN Van Sale is an [Expo](https://expo.dev) React Native app for a mobile seller. A driver
loads up, works a round, and sells from the van: pick products, take payment, print a receipt with
the company's own layout, and let the order carry the GPS location it was raised at. The same app
handles purchases, returns, expenses, stock and the accounting behind them.

Everything it does is backed by custom Odoo 19 modules, all of which ship in
[odoo modules/](odoo%20modules/) beside the app.

## Features

**Selling** — categories, product browsing, cart, a vending cart, order history with detail, and
whole-order discounts.

**Receipts and invoices** — an Invoice Settings hub per company covering general settings, receipt
paper sizes and invoice layouts, plus a template picker (Standard, Dynamic, Cash Memo or a custom
layout) with a server-rendered preview against the most recent order. The **Cash Memo** is a
bilingual English/Arabic Oman-style invoice with C.R. number, GSM, Sultanate line and VAT number,
each independently switchable, and cashier and customer signatures.

**Purchasing** — Easy Purchase with form, list, detail, barcode printing and payment methods; and
Quick Purchase Return for POS-style returns.

**Stock** — stock list and detail, product creation, and on-hand quantities shown as
"X Dozen Y Pcs" where that is how the trade counts.

**Accounting** — invoices list and detail, journal entries, partner ledger, and customer-due
figures on receipts.

**Money and reporting** — expenses with payment methods, sales reports, orders analysis, a
dashboard and a KPI dashboard.

**Administration** — per-user feature gating, user management, home-screen banners, invoice layout
editor, and an in-app user manual served from Odoo.

**Devices** — pairing by QR after the device has been pre-registered by MAC address in Odoo.

**Back-office options** — the Home screen also carries Attendance, Audit, Inventory, Purchases,
CRM, Visits and Visit Plans, Market Study, Task Manager, Box Inspection and Vehicle Tracking.

## Tech stack

| | |
|---|---|
| Framework | Expo SDK ~50, React Native 0.73.6 |
| Navigation | React Navigation 6 |
| State | zustand — stores for `auth`, `box`, `currency`, `network`, `product` |
| Styling | NativeWind (Tailwind for React Native) |
| Networking | axios over Odoo JSON-RPC — [src/api/services/](src/api/services/) |
| Device | expo-camera, expo-barcode-scanner, expo-location, expo-print, react-native-maps |

## Odoo backend

Eleven modules, all in [odoo modules/](odoo%20modules/) — note the space in the folder name.

| Module | Purpose |
|---|---|
| `pos_dynamic_invoice` | Editable, branded POS invoice — logo, company name, GST, footer. v19.0.30.0.0 |
| `pos_order_location` | Tag every POS order with the device GPS coordinates and place name captured at receipt time |
| `pos_total_discount` | Apply discount on total order amount from the POS navbar |
| `product_dozen_display` | Show on-hand stock as "X Dozen Y Pcs" and auto-create the Dozens unit |
| `easy_purchase_apps` | Easy Purchase — one-click purchase entry |
| `quick_purchase_return_apps` | POS-style purchase return for small businesses |
| `user_privilege_manager_apps` | Granular user privileges + app feature gating |
| `hr_expense_payment_method` | Adds a Payment Method field to Expenses |
| `app_banner` | Manage home-screen carousel banners for the mobile app |
| `app_user_manual` | Store the mobile app user-manual PDF in the database |
| `device_login_config` | Pre-register devices by MAC address; only approved devices can configure the app |

> **The three `_apps` modules are parallel builds.** `easy_purchase_apps`,
> `quick_purchase_return_apps` and `user_privilege_manager_apps` use `.app`-suffixed models so they
> install *alongside* their non-app counterparts rather than replacing them. On a server that
> already runs `easy_purchase`, install the `_apps` variant — do not swap one for the other.

## Getting started

**Prerequisites** — Node.js 18+, npm or yarn, and a reachable Odoo 19 server with the modules
above installed.

```bash
npm install
npm start
```

A device pairs by scanning a QR code, having first been registered by MAC address in Odoo. Login
credentials and the session are persisted, so a driver who never logs out comes back to a signed-in
app — see [AUTOFILL_FIX.md](AUTOFILL_FIX.md) for how that was made to work.

`app.json` is generated rather than edited by hand:

```bash
npm run generate-app-json
```

## Building

Profiles are in [eas.json](eas.json):

```bash
eas build -p android --profile preview      # APK
eas build -p android --profile preview4     # internal distribution
eas build -p android --profile production
```

Current release: **v1.5.0**, Android package `com.alphalize.goldenspoon`.

**When bumping a version, edit both `package.json` and `app.json`** so they stay in sync, and bump
`expo.android.versionCode` (integer) and `expo.ios.buildNumber` (string) for every store-bound
build. [CHANGELOG.md](CHANGELOG.md) carries the same rule and the release history.

## Project structure

```
src/
  screens/        Splash, Auth, DeviceSetup (setup + QR scanner), Home (Options +
                  Customer/Services Sections), Categories, Products, Cart, VendingCart,
                  MyOrders, OrdersAnalysis, SalesReport, Dashboard, KPIDashboard,
                  Stock, EasyPurchase, QuickPurchaseReturn, Expenses, Accounting
                  (invoices, journal entries, partner ledger), Admin (app features,
                  invoice settings hub, layouts editor), AppBanners, Users,
                  UserManual, Profile
  api/            config/, endpoints/, services/ (generalApi, deviceApi, easyPurchaseApi,
                  quickPurchaseReturnApi, currencyApi, customerCache, localBanners), utils/
  stores/         zustand: auth, box, currency, network, product
  components/ navigation/ hooks/ utils/ constants/
plugins/          android-cleartext-traffic.js
scripts/          seed_customer_due_demo.py
odoo modules/     the eleven Odoo modules
documents/        user guides, the manual build pipeline, and screenshots
assets_for_manual/
```

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — release history in Keep a Changelog format, with the version-bump
  rules.
- [documents/App documents/](documents/App%20documents/) — `Van_Sale_User_Guide` in
  `Nexgenn_unblured` and `Common_blurred` variants, plus the Golden Spoon Vegetables manual.
- [documents/manual/](documents/manual/) — the build pipeline (`build_manual.py`,
  `build-manual.ps1`) and the screenshots the guide is assembled from.
- [AUTOFILL_FIX.md](AUTOFILL_FIX.md) — why credentials and sessions did not persist across
  restarts, and what fixed it.
- [docs/legacy-README.md](docs/legacy-README.md) — the previous README, an unformatted plain-text
  overview written when the app was described as "NEX GENN POS". Kept for reference.
