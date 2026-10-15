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

## [1.7.1] - 2026-10-15

### Added
- **"How to return" hint on the return register.** A yellow bar at the top of
  the return screen opens to explain the buttons: − returns more, + returns
  fewer, and delete means the customer keeps the product.

### Fixed
- **Return Products returned every product.** Deleting some products in the
  register before tapping Payment still returned the whole order. Return
  Products now only fills the register, and Payment saves just the products
  left on screen. Backing out saves nothing.
- **Return the rest later.** Return Products stays available while any product
  on the order hasn't been returned yet, and offers only those products.
- **Returns use the price the customer paid** (after line discount) and keep
  the original customer.
- **Older return drafts.** Paying one from the Orders list now links it to the
  original sale, and Payment stops with an error if an old draft can't be
  removed instead of saving a second return.

## [1.7.0] - 2026-10-13

### Added
- **Payment Receipts tile (Accounting).** Take customer payments from the phone.
  - **Credit Customers** lists everyone who owes money, with their due, last
    payment and any draft total. Tap a customer to take a receipt.
  - The form has the same fields as the server's customer payment form. Payment
    Type is fixed to Receive, and the amount can't be more than the customer's
    due. Journal and payment method open in a centered picker, and the
    customer's payment history is listed below the form.
  - **Save Draft** keeps the receipt as a draft. **Confirm** asks you to
    double-check, reads the due again and posts the payment.
  - Leaving with unsaved changes asks whether to Save or Discard.
  - **Draft** and **Done** tabs list the receipts in each state.

### Changed
- App builds now run on the new EAS project.

## [1.6.0] - 2026-10-05

### Added
- **Company switching in Profile.** On a server with several companies, Profile
  shows a **Company** row; tap it, pick a company and confirm. Registers,
  products, customers and every other list then show only that company's data,
  like the company switcher in the web backend. With a single company the row
  just shows its name. The choice is remembered for the next login.
- **Customer Due banner without the server module.** The yellow due banner on an
  order and the amber "Due" pill in My Orders now also show when the server
  doesn't have the dynamic-invoice module: the app shows what the customer owes
  right now. With the module installed, the balance at the time of sale is shown
  as before.
- **Opening Balance tile (Accounting).** Enter old customers' credit balances
  from the paper records, by age (0–30, 31–60, 61–90, 91–120, >120 days), and
  post them without anyone opening the web backend.
  - The customer picker shows the customer list straight away and filters as
    you type. "Create <name>" opens the customer form, and the new customer
    comes back selected.
  - Entries are kept on the phone until they're published.
  - **Publish** asks for the admin's login password, which the server checks;
    it's never stored. The app then builds the same Excel file the accountants
    used to upload and runs it through the existing opening-balance import. It
    checks every line before importing and posts the journal entry.
  - If the server doesn't answer, Retry picks up where the publish stopped and
    never posts twice.
  - If the server doesn't have the opening-balance module, the screen says so
    and Publish is disabled.
  - A yellow ⚠️ note asks to check every amount twice as soon as one is typed,
    and again before publishing, since posted balances can't be changed or
    published again.

### Fixed
- **Place Order failed with a server error on some registers** of a
  multi-company database (e.g. a register of company 2): the order and its
  payment were always created under company 1. They now use the register's own
  company, falling back to the company chosen in Profile.

## [1.5.1] - 2026-09-09

### Fixed
- **Return Products failed outright** with an Odoo `AccessError` about `account.tax`.
  Products shared across companies carry every company's sale tax, and the app
  summed all of them with no company filter — so a GROCERY SHOP line was booked
  with both 15% (company 1) and 5.75% (company 3). That overcharged **20.75%
  instead of 15%**, and stamped each line with a tax the POS session cannot read
  back, which is what made Odoo refuse the refund while recomputing its prices.
  Product taxes are now filtered to the register's company, mirroring Odoo's
  `account.tax._filter_taxes_by_company` including the parent-company walk.
- **The register's company is no longer hard-coded to 1**, so on a multi-company
  database an order is booked against the POS it was actually rung on.
- **A paid return was not linked to the order it came from.** Odoo's linked
  refund draft was discarded and a standalone negative order written in its
  place, with no `refunded_orderline_id`. Odoo therefore never marked the
  original as returned: the same item could be refunded again from any other
  device, the refund carried no `REFUND` name, and partial returns could not be
  tracked. Also fixed the id taken from `sync_from_ui` — once a line carries the
  refund link Odoo returns `[original_id, new_refund_id]`, and reading the first
  entry re-paid the order being refunded and decremented its stock twice.
- **Returned goods were never put back on hand.** The stock fallback skipped
  every refund line via a `qty <= 0` guard; non-storable products are now
  skipped instead, since Odoo keeps no quants for them.
- **Refund orders looked like ordinary refundable sales.** `refunded_order_id`
  and `refund_orders_count` were requested from Odoo but dropped before reaching
  the screen, so a refund showed no `REFUND` chip, no "Refunded from" link, and
  still offered a Return Products button — letting a cashier refund a refund.
- **Quantity steppers on return lines.** A return line carries a negative
  quantity, which the controls never accounted for: `−` deleted the whole line
  instead of stepping `-8 → -9`, `+` ran to `0` and left an empty line, and
  typing a quantity turned `-1` into `+1` — a sale booked on a refund order.
  `+` now returns fewer units, `−` returns more, both capped at the quantity
  actually sold. **Piece-wise returns (return 2 of 10) work for the first time.**
- Refund failures now surface Odoo's actual message in a modal that stays on
  screen, instead of a two-second toast that discarded it.

### Changed
- App display name is now **NEXGENN Van-Sale** (was `NEXGENN VAN-SALE`).
- Android package is now `com.alphalize.vansale` (was `com.alphalize.goldenspoon`).

### Notes
- **The package change makes this a different application to Android.** Existing
  installs of `com.alphalize.goldenspoon` will not update to it — the two sit
  side by side, and the new one starts with no data, so devices must be
  re-registered. Any Play Store listing stays bound to the old package.
- Historical orders placed before this release keep the 20.75% they were charged.
  Returns of them refund exactly what was paid, which is intended; deciding
  whether to compensate those customers is a commercial call.
- `app.json` is generated by `generateAppJson.js` from `.env` via `getConfig`.
  The name, package and version above were set by hand, so running that
  generator will overwrite them with `EXPO_PUBLIC_APP_NAME_ALPHA` /
  `EXPO_PUBLIC_PACKAGE_NAME_ALPHA` unless `.env` is updated to match.

## [1.5.0] - 2026-09-03

### Added
- **Customer Due saved on the order.** What a customer owed is now recorded on
  the sale itself rather than recomputed on every print. Four stored fields on
  `pos.order` (Previous Due / This Order Due / Total Due, plus a captured flag),
  written once when the app finishes a sale and frozen from then on — reopening
  an old order shows what was owed on that day, not today.
- **Due pill on the Orders list.** Rows carrying a due show an amber
  `Due <amount>` pill beside the Receipt and Tax pills.
- **Customer Due card** on the Order Detail screen, and a **Due chip** in its
  action row.
- **Due breakdown popup**, opened from either the pill or the chip. Shows the
  frozen totals from the sale alongside the customer's open invoices as they
  stand now — labelled separately, because once the customer pays, the two
  legitimately differ.

### Fixed
- The "Thank you for your purchase!" note at the end of the post-payment
  preview could not be scrolled into view — the sticky footer floated over it
  and the scroll area reserved too little room. The footer is now measured, so
  the reserved space matches whatever it actually renders (it varies: the
  "PDF (Credit)" chip is conditional).
- A credit sale recorded This Order Due as 0. `pos.order.amount_paid` counts the
  Customer Account tender as paid, so the linked invoice's residual is used
  instead.

### Notes
- Requires `pos_dynamic_invoice` **19.0.31.0.0** or later for the due fields.
  Without it the app degrades quietly: no pills, no card, and every other screen
  behaves exactly as before.
- Orders placed before this release, or created outside the app, carry no
  snapshot and show no due — the captured flag is what distinguishes them from a
  customer who genuinely owes nothing.

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
