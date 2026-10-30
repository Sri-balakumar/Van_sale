# Compact Dynamic Invoice: Plan

Status: planned, not built yet (2026-10-29).

**Preview:** [Van Sale Receipt Preview](https://claude.ai/artifact/1iZefmU6cRUCxvciwE85tw).
It shows the current receipt and the new compact one side by side, using the client's
sample bill, with a 50 / 76 / 80 mm paper switch and the balance section at the end. The
link is private; share it from the page's Share menu before sending it to anyone else.

## Why

The client wants the printed receipt to look like their sample thermal bill (Dubai
Shopping Center). The current receipt has boxes around the header, large fonts and big
gaps, so it wastes paper. The client asked for:

- Company name and details as plain lines, with no box.
- Small fonts, tight spacing and no wasted white space.
- Two short lines per product: name and code, then Qty / Rate / Total / Vat / Amount.
- A balance section at the end, in English and Arabic.
- Customer details controlled by a setting.

## Scope

| Template | Changed? |
|---|---|
| **Dynamic** | Yes. Everything in this plan applies to Dynamic only. |
| Custom Layout | No |
| Standard (app built-in and server normal mode) | No |
| Cash Memo | No |

Most of the work is in the server module `odoo modules/pos_dynamic_invoice`. The only
app-side change is one new switch on the Invoice Settings screen.

## Target receipt (80 mm)

```
          DUBAI SHOPPING CENTER
       DARSAIT, Sultanate of Oman
          VATIN  OM1100027845
        GSM  99796814,97442573
            Invoice / فاتورة
Invoice No   (رقم الفاتورة)        JS23048084
Invoice Date (التاريخ)      08-10-2026 01:45 PM
Cashier      (الكاشير)                 VAN 01
Customer     (الزبون)          LAILA AL FAJR
Mobile       (الجوال)               99112233
------------------------------------------------
Qty      Rate     Total     Vat      Amount
------------------------------------------------
1. BEEF LIVER 10KG                         1008
   كبد بقر 10 كيلو
3.00    8.500    25.500    0.000     25.500
................................................
2. FRENCH FRIES 6MM COATED H             013930
10.00   7.333    73.330    3.667     77.000
................................................
Discount        (خصم)                     0.000
Total W/O Vat                           443.919
Vat 5%          (الضريبة)                 5.681
Net Amount      (الصافي)            OMR 450.600
================================================
Today Bill Total / إجمالي فاتورة اليوم      450.600
Previous Outstanding / الرصيد السابق      120.000
Total Amount / المبلغ الإجمالي             570.600
Paying Amount (Cash) / المبلغ المدفوع      300.000
------------------------------------------------
Balance Due / الرصيد المستحق           OMR 270.600
================================================
           Thank you / شكرا لشرائك
```

## 1. Header

- Plain centred lines with no table or border:
  - logo (if on)
  - Arabic company name (if its switch is on)
  - company name in bold
  - address lines
  - Sultanate of Oman, VATIN, C.R. No and GSM, each behind its existing switch
  - phone (when GSM is off)
  - email
- The title prints as plain bold centred text, with no lines or box around it.

## 2. Customer details: new setting

New switch in Invoice Settings, in the Dynamic section: **Show Full Customer Details**
(default **off**).

| Switch | Customer lines printed |
|---|---|
| Off | Customer name, Mobile |
| On | Customer name, Mobile, Address, VATIN, Email (each only if filled in) |
| Walk-in sale (no customer) | None |

Mobile uses the customer's `mobile` field when the server has it, otherwise `phone`.

## 3. Items

- Header row: Qty / Rate / Total / Vat / Amount, with the Arabic label under each.
- For each product:
  - line 1: `n. product name` with the product code on the right (internal reference,
    or the barcode when there is none)
  - Arabic product name on its own line, if one exists (see section 6)
  - the five numbers
  - a dotted rule after it
- Total = excluding VAT, Vat = line VAT, Amount = including VAT.
- Numbers print without the currency. Only Net Amount and Balance Due show it.

## 4. Totals

- Discount (only if more than 0)
- Total W/O Vat
- Vat with its rate, for example `Vat 5%`. The rate only shows when every taxed line has
  the same rate.
- Net Amount, in bold, with the currency

## 5. Balance section (at the end, English and Arabic)

Shown whenever the bill has a customer, even if the old balance is 0.000.

| English | Arabic | Calculation |
|---|---|---|
| Today Bill Total | إجمالي فاتورة اليوم | This bill's Net Amount |
| Previous Outstanding | الرصيد السابق | What the customer owed before this bill (existing `_partner_previous_due`) |
| Total Amount | المبلغ الإجمالي | Today Bill Total + Previous Outstanding |
| Paying Amount (method) | المبلغ المدفوع | Money taken now, up to the bill amount |
| Balance Due | الرصيد المستحق | Total Amount − Paying Amount, bold, with currency |
| Change | الباقي | Only when cash paid is more than the bill |

- This section replaces the old "Previous Due / This Invoice / Total Due" lines and the
  "Payment Details" rows.
- A walk-in sale gets one short "Paid (method) / Change" line instead.

## 6. Arabic product names

- Use Odoo's own translation of the product name. Do not type Arabic into the English name.
  1. Odoo, Settings, Languages: add Arabic.
  2. On each product, use the EN / AR button next to the Name field to type the Arabic
     name. For many products at once, export to Excel, fill in the names and import them back.
- The receipt prints the Arabic name in small right-to-left text under the English name.
- When Arabic is not turned on, or a product has no Arabic name, only the English line
  prints. Nothing breaks.

## 7. Paper sizes

The receipt follows the paper size chosen in the app. The side margin is 2 mm on each
side, so the receipt is 4 mm narrower than the paper.

| Paper | Receipt width | Text size |
|---|---|---|
| 2 inch (50 mm) | 46 mm | 8.5px (long labels wrap, amounts stay on one line) |
| 3 inch (76 mm) | 72 mm | 10.5px |
| 80 mm | 76 mm | 10.5px |
| 4 inch (100 mm) | 96 mm | 10.5px |
| A5 / A4 | 144 / 206 mm | 11.5px |

## Implementation

### Server module (`odoo modules/pos_dynamic_invoice`)

**`models/pos_invoice_settings.py`**
```python
show_dyn_customer_details = fields.Boolean(
    string='Show Full Customer Details', default=False,
    help='Dynamic invoice: off = customer name + mobile; '
         'on = also address, VAT number and email.')
```

**`views/pos_invoice_settings_views.xml`**
- Add a toggle in the Dynamic group, using the same markup as `show_dyn_name_ar`.

**`models/dynamic_receipt_mixin.py`**
- `_receipt_number_formatter()`: same decimal places as `_receipt_money_formatter`, with
  no currency symbol.
- Common VAT % label, worked out from the lines' `tax_ids`.
- `_apply_receipt_settings` adds:
  - `show_dyn_customer_details`. The normal-mode branch forces it to False.
  - Customer keys: `customer_mobile`, `customer_address_lines`, `customer_vat`,
    `customer_email`.
  - Balance keys: `bill_total_n`, `prev_due_n`, `grand_due_n`, `paying_n`,
    `paying_label`, `balance_f`, `change_n`, `show_change`, `show_balance_summary`.

**`models/pos_order.py` and `models/account_move.py`, in `_base_receipt_data`**
- Only new keys are added. The existing keys stay, because Standard, Cash Memo and Custom
  Layout read them.
- Per item:
  - `code`
  - `qty_f` (2 decimals)
  - `rate_n`
  - `excl_n`
  - `vat_n` (including VAT minus excluding VAT)
  - `amount_n`
  - `name_ar` (the product name in the first active Arabic language; blank when there is
    none or it matches the English name)
- Order level:
  - `discount_n`
  - `untaxed_n`
  - `tax_n`
  - `datetime` (`dd-mm-YYYY hh:mm AM/PM`; date only for an accounting invoice)

**`report/pos_dynamic_invoice_report.xml`**
- New template `report_pos_dynamic_invoice_compact_doc`.
- The dispatcher `report_pos_dynamic_invoice_doc` gets
  `t-elif="d['invoice_template'] == 'dynamic'"`, which calls the compact template. The
  existing `t-else` keeps `report_pos_dynamic_invoice_standard_doc`, so the server
  Standard receipt is unchanged.
- The receipt reads left to right in Arial. The Arabic text inside it runs right to left.

Customer section logic:
```xml
<t t-if="d['customer']">
  <div class="l">Customer <i>(الزبون)</i></div><div class="v" t-esc="d['customer']"/>
  <t t-if="d['customer_mobile']"><div class="l">Mobile <i>(الجوال)</i></div><div class="v" t-esc="d['customer_mobile']"/></t>
  <t t-if="d['show_dyn_customer_details']">
    <t t-if="d['customer_address_lines']"><div class="l">Address <i>(العنوان)</i></div><div class="v"><t t-foreach="d['customer_address_lines']" t-as="a"><div t-esc="a"/></t></div></t>
    <t t-if="d['customer_vat']"><div class="l">VATIN <i>(الرقم الضريبي)</i></div><div class="v" t-esc="d['customer_vat']"/></t>
    <t t-if="d['customer_email']"><div class="l">Email</div><div class="v" t-esc="d['customer_email']"/></t>
  </t>
</t>
```

Spacing rules:
```css
@page { size: <width>mm auto; margin: 2mm; }      /* was 4mm + 4mm padding */
.cd { width: <width - 4>mm; font: 10.5px/1.25 Arial, sans-serif; color: #000; }
.cd.narrow { font-size: 8.5px; }                  /* <= 58mm */
.cd.sheet  { font-size: 11.5px; }                 /* >= 148mm */
.cd .hd { text-align: center; }                   /* no border, no table */
.cd .ttl { text-align: center; font-weight: 700; margin: 4px 0 2px; }
.cd .info { display: grid; grid-template-columns: auto 1fr; column-gap: 6px; }
.cd .info .v { text-align: right; }
.cd th, .cd td { padding: 1px; }                  /* was 6px 4px */
.cd tr.v td { padding-bottom: 3px; border-bottom: 1px dotted #000; white-space: nowrap; }
.cd .row { display: flex; justify-content: space-between; padding: 1px 0; }
```

**`__manifest__.py`**
- Bump the version: `19.0.31.0.0` → `19.0.32.0.0`.

### App

- `src/api/services/generalApi.js`: add `show_dyn_customer_details` to
  `INVOICE_SETTINGS_FIELDS`.
- `src/screens/Admin/InvoiceSettingsScreen.js`: add state, load and save for the new
  setting, plus a switch in the Dynamic card after "Show Sultanate of Oman":
  ```js
  <Row label="Show full customer details" value={showDynCustomerDetails} onValueChange={setShowDynCustomerDetails} />
  ```
- This needs a new APK, with the version bumped in app.json.

## Rollout order

1. Upgrade the `pos_dynamic_invoice` module on the server first.
2. Then install the new APK. If the app asks for the new setting before the server is
   upgraded, the Invoice Settings screen fails to load.
3. The receipt layout itself is server-side, so it changes as soon as the module is
   upgraded, even on the old APK.

## Testing

Use the local van_sale test database (localhost:8069) only. Never test on the client's
live database.

1. Upgrade `pos_dynamic_invoice`. Open Invoice Settings in Odoo and in the app, and check
   that the new switch loads and saves.
2. Set up a test sale:
   - one product with 5% VAT and one with 0% VAT
   - a discount
   - a customer with a phone, address and VAT number, and an older unpaid invoice
   - a partial cash payment
3. With Dynamic selected and the switch **off**, print at 80, 76 and 50 mm and at A5.
   Only the customer name and mobile should show, and the balance figures should add up.
4. Switch it **on**: the address, VATIN and email should appear.
5. Make a walk-in sale: no customer lines and no balance section.
6. Print once each with Custom Layout, Standard and Cash Memo, and check they are unchanged.
7. Print an accounting invoice (account.move) with Dynamic.
8. Turn on Arabic, give one product an Arabic name, and check that the line prints. Leave
   another product without one and check it prints in English only.
