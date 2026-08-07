# Changelog

All notable changes to the mobile app are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/) and the
project uses [Semantic Versioning](https://semver.org/) for app versions
(`MAJOR.MINOR.PATCH`).

When bumping, edit BOTH `package.json` and `app.json` so they stay in
sync. Also bump `app.json -> expo.ios.buildNumber` (string) and
`app.json -> expo.android.versionCode` (integer) for every store-bound
build.

## [Unreleased]

## [1.4.0] - 2026-08-07

### Added
- Invoice Settings rebuilt as a three-screen hub per company: **General
  Settings**, **Receipt Paper Sizes** and **Invoice Layouts**.
- **Invoice Template** picker (Standard / Dynamic / Cash Memo / Custom
  Layout) replaces the old "Use Dynamic Invoice on App" master switch,
  with a server-rendered Preview against the most recent order.
- **Cash Memo** receipt: a bilingual English/Arabic Oman-style invoice
  with C.R. number, GSM, Sultanate line and VAT number (each with its own
  show/hide switch), an enlarged logo, and a cashier/customer signature
  row.
- **Receipt Paper Sizes** admin: sizes entered in inches with the mm
  width derived automatically, height 0 for a continuous roll,
  reorder/edit/delete, plus a locked per-company "Custom" entry. Replaces
  the fixed 2"/3"/3.5"/4" preset list.
- **Invoice Layouts** admin and a landscape drag-and-drop visual editor
  (Design / Options / Live Preview) with per-paper-size block layouts,
  undo/redo and auto-save.
- **Use Default Receipt Size**: when set, Preview / Download / Print skip
  the size prompt in both the app and the Odoo preview.
- **Customer due on receipts**: a Previous Due card on the POS payment
  screen, and Previous Due / This Invoice / Total Due rows on every
  receipt template when the customer still owes money.
- **Print PDF** on accounting invoices — renders through the shop's own
  invoice template and paper size, alongside the unchanged Download PDF.
- Products: unit-of-measure management (Add Unit, reference units),
  multi-category assignment, a Track Inventory toggle, Dozen Display
  (pieces per dozen, on-hand in dozens, "Dozen + Pcs" readout), delete
  with an archive fallback, and a Show Archived / Restore flow.
- Partner Ledger filters: posting status, review, reconciliation,
  journal, account type and date/invoice-date periods, with removable
  chips and a pinned grand-total row.
- In-app **User Manual** tile plus a HELP card on Profile, with a
  per-device "Show to users" toggle for administrators.

### Changed
- All receipt sizes now print at 100% on a single continuous page instead
  of being scaled or split.
- Customer returns support partial quantities, with tax locked to what
  was originally charged and scaled to the quantity returned; refund
  orders carry a REFUND badge and a link back to the original sale.
- Quick Return shows Purchased / Already Returned / Max Returnable per
  line with clamping validation, and a "Return all" shortcut.
- Profile avatar is now the user's initial rather than a generic image.

### Fixed
- New products no longer fail to create on databases without a default
  internal category.
- Product save now enables only when something has actually changed, and
  a category created inline appears immediately.
- Partner Ledger value display and filtering corrected.

## [1.3.0] - 2026-07-02

### Added
- Dynamic POS invoice: a branded, editable receipt (logo, shop name,
  address, GST/VAT number, header title, footer, show/hide the tax row
  and signatures) rendered server-side at all paper sizes. New Odoo
  module `pos_dynamic_invoice`, gated by a per-company "Use Dynamic
  Invoice on App" master switch.
- In-app Invoice Settings admin (Home → Administration → Invoice
  Settings): a per-company list plus an editor to toggle dynamic mode
  and edit all branding, logo, header/footer and show/hide options.
  Edits share the same record as the Odoo back office.
- Customer and cashier signature capture on the receipt.
- In-app user manual, with per-user hide/unhide.

### Changed
- App renamed to NEXGENN VAN-SALE.
- White background behind the NEXGENN POS logo on the profile page.

## [1.2.0] - 2026-05-13

### Added
- POS order GPS capture on Validate Payment, with a Location chip on
  the post-payment receipt and the past-order detail screen. New Odoo
  module: `pos_order_location` (19.0.1.0.1).
- App Banners admin (in-app screens + new `app_banner` Odoo module
  19.0.2.0.0). 3:1 crop on upload via `expo-image-picker`, kanban
  view in the Odoo backend with 3:1 cards, header Archive / Delete
  buttons, chatter audit trail.
- Invoice paper-size picker (2" / 3" / 3.5" / 4") that fires before
  Preview / Download / Print on both the post-payment receipt and the
  past-order detail.
- Apps Privileges admin overhaul (rename, Hide All / Reset All bulk
  actions, ConfirmModal popups).
- Login-time location-permission prompt (asks once per install via
  `AsyncStorage` flag).
- `ConfirmModal` component — centered LogoutModal-style popup that
  replaces the system `Alert.alert` for destructive flows like banner
  delete.

### Changed
- Home tiles redesigned to a 2-column horizontal-row layout. Each tile
  carries the parent section's accent as a left stripe; titles fit on
  one line; tap target is wider.
- `OrderDetailScreen` items now render product images (fetched via a
  follow-up `product.product` read) and use a bidi-safe qty x price
  meta line that no longer reorders around the Arabic currency symbol.
- `Home` carousel banner card locked to 3:1 aspect on every device, so
  what the admin uploads at 3:1 displays without `cover`-cropping.

### Removed
- Local `assets/images/Home/Banner` fallback. The Home carousel only
  ever shows banners served by the `app.banner` Odoo module now.
- Sequence field UI on the banner admin (the column stays in the
  schema for backward compatibility; the app sends a constant `10`).
- Re-crop entry points on the Banners admin (the in-app crop screen
  and the navigator route). The first-time gallery picker's 3:1 crop
  is enough.

## [1.1.0] - prior release
- First publicly distributed version of the app. No detailed changelog
  was kept before this entry.
