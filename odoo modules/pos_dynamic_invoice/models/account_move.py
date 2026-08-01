import json

from odoo import fields, models


class AccountMove(models.Model):
    """Dynamic-invoice support for account.move (Accounting → Invoices).

    Builds the SAME receipt dict pos.order produces, so an accounting invoice
    renders through all four templates (Standard / Dynamic / Cash Memo /
    Custom Layout) with no template or layout-editor changes — the QWeb only
    ever reads that dict. Exposes get_dynamic_invoice_html() so the mobile app
    can print an invoice at any configured paper size.

    No new stored fields — everything is read from the move, its lines and its
    reconciled payments.
    """
    _name = 'account.move'
    _inherit = ['account.move', 'pos.dynamic.receipt.mixin']

    # ------------------------------------------------------------------
    # Mixin hooks
    # ------------------------------------------------------------------
    def _receipt_amount_paid(self):
        return (self.amount_total or 0.0) - (self.amount_residual or 0.0)

    def _receipt_barcode_value(self):
        self.ensure_one()
        return self.name or str(self.id)

    def _receipt_refunded_amount(self):
        return abs(self.amount_total or 0.0) if self.move_type == 'out_refund' else 0.0

    def _receipt_excluded_move(self):
        """This invoice itself — it is posted by print time, so its own
        receivable must not also count as the customer's PREVIOUS due."""
        return self

    def _receipt_show_signature_block(self):
        """An accounting invoice is not signed on handover — the POS sale is.
        Printing empty ruled lines here just wastes paper."""
        return False

    # ------------------------------------------------------------------
    # Payments — the reconciled rows Odoo shows in the invoice form footer
    # ------------------------------------------------------------------
    def _receipt_payment_rows(self, fmt):
        """Rows for the Payments block, read from Odoo's own computed widget.

        `invoice_payments_widget` is the same source the web invoice form and
        the app's invoice detail screen use, so the printed rows always match
        what the user already sees. It can come back as a JSON string, a dict
        or False depending on Odoo version — handle all three.
        """
        self.ensure_one()
        widget = self.invoice_payments_widget
        if not widget:
            return []
        if isinstance(widget, str):
            try:
                widget = json.loads(widget)
            except (ValueError, TypeError):
                return []
        content = (widget or {}).get('content') or []
        rows = []
        for entry in content:
            if not isinstance(entry, dict):
                continue
            rows.append({
                'name': entry.get('journal_name') or entry.get('ref') or 'Payment',
                'amount_f': fmt(entry.get('amount') or 0.0),
            })
        return rows

    # ------------------------------------------------------------------
    # Invoice payload — the same dict shape pos.order._base_receipt_data emits
    # ------------------------------------------------------------------
    def _base_receipt_data(self):
        self.ensure_one()
        fmt = self._receipt_money_formatter()
        company = self.company_id or self.env.company

        city_state_zip = ', '.join(
            p for p in [company.city, company.state_id.name if company.state_id else None, company.zip] if p
        )
        address_lines = [
            line for line in [
                company.street, company.street2, city_state_zip,
                company.country_id.name if company.country_id else None,
            ] if line
        ]
        company_block = {
            'name': company.name or 'Company',
            'address_lines': address_lines,
            'phone': company.phone or '',
            'email': company.email or '',
        }

        items = []
        raw_subtotal = 0.0
        # `display_type` filters out section / note pseudo-lines, which carry no
        # quantity or price and would otherwise print as empty rows.
        product_lines = self.invoice_line_ids.filtered(lambda l: not l.display_type)
        for index, line in enumerate(product_lines):
            qty = float(line.quantity or 0.0)
            unit = float(line.price_unit or 0.0)
            gross = unit * qty
            raw_subtotal += gross
            discount_pct = float(line.discount or 0.0)
            item_discount = gross * discount_pct / 100.0
            items.append({
                'num': index + 1,
                'name': line.name or (line.product_id.display_name if line.product_id else '') or 'Product',
                'qty': ('%g' % qty),
                'unit_f': fmt(unit),
                'disc_f': ('-%s' % fmt(item_discount)) if item_discount > 0 else '0',
                'total_f': fmt(line.price_total),
                'note': '',
            })

        amount_total = float(self.amount_total or 0.0)
        amount_tax = float(self.amount_tax or 0.0)
        amount_paid = self._receipt_amount_paid()
        rolled_discount = max(0.0, round((raw_subtotal - (amount_total - amount_tax)) * 1000) / 1000.0)

        payments = self._receipt_payment_rows(fmt)
        has_payments = bool(payments)

        date_str = self.invoice_date.strftime('%d/%m/%Y') if self.invoice_date else ''

        return {
            'company': company_block,
            'customer': self.partner_id.name if self.partner_id else '',
            'cashier': self.invoice_user_id.name if self.invoice_user_id else 'Cashier',
            # The FULL invoice number (e.g. "INV/2026/00012"). Deliberately not
            # _extract_order_ref, which keeps only trailing digits and would
            # drop the series an accounting document is identified by.
            'order_ref': self.name or '',
            'date': date_str,
            'items': items,
            'subtotal_f': fmt(raw_subtotal or amount_total),
            'show_discount': rolled_discount > 0,
            'discount_f': fmt(rolled_discount),
            'show_tax': amount_tax > 0,
            'tax_f': fmt(amount_tax),
            'total_f': fmt(amount_total or raw_subtotal),
            'has_payments': has_payments,
            'is_split': len(payments) > 1,
            'payments': payments,
            # "Change" is cash-tendered, a POS-only concept — an invoice can
            # never have any. The Cash Memo's Advance / Due box carries the
            # equivalent information (paid vs residual).
            'show_change': False,
            'change_f': fmt(0.0),
            'cash_f': fmt(amount_paid if amount_paid > 0 else amount_total),
            'cash_change_f': fmt(0.0),
            # account.move has no signature capture; the block still prints its
            # ruled lines for the customer to sign on paper.
            'customer_signature': False,
            'shop_owner_signature': False,
        }

    # ------------------------------------------------------------------
    # App entry point — rendered invoice HTML for a chosen paper size
    # ------------------------------------------------------------------
    def get_dynamic_invoice_html(self, paper_size='80', paper_height=0):
        """Return this invoice as a self-contained HTML string at `paper_size`
        (mm width). Called by the React Native app over JSON-RPC; the rendering
        is shared with pos.order via the mixin — see _render_dynamic_html.
        """
        self.ensure_one()
        return self._render_dynamic_html('move_id', paper_size, paper_height)
