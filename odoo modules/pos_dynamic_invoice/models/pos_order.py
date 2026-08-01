from odoo import fields, models


class PosOrder(models.Model):
    """Dynamic-invoice support for pos.order.

    Builds the receipt payload server-side (ported from the app's
    buildInvoiceParams + src/utils/invoiceHtml.js, same shape as the
    pos_receipt_preview module). The pos.invoice.settings branding layer, the
    Customer Due computation and the money/ref/logo/barcode helpers live in
    pos.dynamic.receipt.mixin, which account.move shares so both print through
    the same four templates. Exposes get_dynamic_receipt_html() so the mobile
    app can fetch the rendered receipt HTML for any of the six paper sizes.

    No new stored fields are added — order data is read from existing
    pos.order / pos.order.line / pos.payment records plus the signature
    ir.attachment rows the app already writes.
    """
    _name = 'pos.order'
    _inherit = ['pos.order', 'pos.dynamic.receipt.mixin']

    # ------------------------------------------------------------------
    # Backend button -> open the paper-size popup
    # ------------------------------------------------------------------
    def action_open_dynamic_receipt_preview(self):
        """Preview the dynamic receipt for this order.

        When the company has a default receipt size set (Invoice Settings →
        Receipt Size), skip the 'choose size' popup and render straight at that
        size — mirroring the app, which also skips its size prompt. Otherwise
        open the size wizard as before.
        """
        self.ensure_one()
        settings = self.env['pos.invoice.settings'].get_for_company(
            self.company_id or self.env.company)
        if settings.use_default_paper_size:
            # `default_paper_size` is now a KEY; resolve it to mm and always
            # render via the custom path (the wizard Selection only knows the
            # fixed preset strings, not an edited mm).
            width, height = settings._resolved_default()
            wizard = self.env['pos.dynamic.invoice.wizard'].create({
                'order_id': self.id,
                'paper_size': 'custom',
                'custom_width': width,
                'custom_height': height,
            })
            return wizard.action_preview()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Preview Receipt (Dynamic)',
            'res_model': 'pos.dynamic.invoice.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_order_id': self.id},
        }

    # ------------------------------------------------------------------
    # POS-specific receipt hooks (the generic helpers live in the mixin)
    # ------------------------------------------------------------------
    def _receipt_amount_paid(self):
        """What the customer has actually PAID for this order.

        `pos.order.amount_paid` counts the Customer Account tender as paid, so
        a credit sale looks fully settled and its amount would drop out of the
        receipt entirely: `due` computes to 0, while the order's own invoice is
        (correctly) excluded from the customer's PREVIOUS due. When the order is
        invoiced the invoice residual is the truth, so use it — Advance / Due
        and the Customer Due block then all reflect money actually received.
        """
        if self.account_move:
            return (self.amount_total or 0.0) - (self.account_move.amount_residual or 0.0)
        return self.amount_paid or 0.0

    def _receipt_barcode_value(self):
        self.ensure_one()
        return self.pos_reference or self.name or str(self.id)

    def _receipt_refunded_amount(self):
        total = self.amount_total or 0.0
        return abs(min(0.0, total)) if total < 0 else 0.0

    def _receipt_excluded_move(self):
        """This order's linked invoice — its receivable is already posted by
        print time, so it must not also count as the customer's PREVIOUS due."""
        return self.account_move

    def _receipt_signatures(self):
        """Read the two signature attachments (base64 PNG, no data: prefix)."""
        sig = {'customer_signature': False, 'shop_owner_signature': False}
        attachments = self.env['ir.attachment'].sudo().search([
            ('res_model', '=', 'pos.order'),
            ('res_id', '=', self.id),
            ('name', 'in', ['customer_signature', 'shop_owner_signature']),
        ])
        for attachment in attachments:
            raw = attachment.datas
            if not raw:
                continue
            sig[attachment.name] = raw.decode() if isinstance(raw, bytes) else raw
        return sig

    # ------------------------------------------------------------------
    # Order payload (before settings) — ports buildInvoiceParams
    # ------------------------------------------------------------------
    def _base_receipt_data(self):
        """Build the receipt dict from order data only (no branding overrides).

        Company block exposes `address_lines` (a list) so the template can loop
        it regardless of whether the address comes from res.company or the
        settings free-text field.
        """
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
        for index, line in enumerate(self.lines):
            qty = float(line.qty or 0.0)
            unit = float(line.price_unit or 0.0)
            gross = unit * qty
            raw_subtotal += gross
            discount_pct = float(line.discount or 0.0)
            item_discount = gross * discount_pct / 100.0
            line_total = line.price_subtotal_incl
            if line_total is False or line_total is None:
                line_total = line.price_subtotal
            items.append({
                'num': index + 1,
                'name': line.full_product_name or (line.product_id.display_name if line.product_id else '') or 'Product',
                'qty': ('%g' % qty),
                'unit_f': fmt(unit),
                'disc_f': ('-%s' % fmt(item_discount)) if item_discount > 0 else '0',
                'total_f': fmt(line_total),
                'note': line.customer_note or '',
            })

        amount_total = float(self.amount_total or 0.0)
        amount_tax = float(self.amount_tax or 0.0)
        amount_paid = float(self.amount_paid or 0.0)
        rolled_discount = max(0.0, round((raw_subtotal - (amount_total - amount_tax)) * 1000) / 1000.0)

        payments = []
        for payment in self.payment_ids:
            payments.append({
                'name': payment.payment_method_id.name if payment.payment_method_id else 'Payment',
                'amount_f': fmt(payment.amount or 0.0),
            })
        has_payments = bool(payments)
        change_amount = amount_paid - amount_total if amount_paid > amount_total else 0.0

        date_str = ''
        if self.date_order:
            local_dt = fields.Datetime.context_timestamp(self, self.date_order)
            date_str = local_dt.strftime('%d/%m/%Y')

        signatures = self._receipt_signatures()

        return {
            'company': company_block,
            'customer': self.partner_id.name if self.partner_id else '',
            'cashier': self.user_id.name if self.user_id else 'Cashier',
            'order_ref': self._extract_order_ref(self.name, self.id),
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
            'show_change': has_payments and change_amount > 0,
            'change_f': fmt(change_amount),
            'cash_f': fmt(amount_paid if amount_paid > 0 else amount_total),
            'cash_change_f': fmt(amount_paid - amount_total if amount_paid > amount_total else 0.0),
            'customer_signature': signatures['customer_signature'],
            'shop_owner_signature': signatures['shop_owner_signature'],
        }

    # ------------------------------------------------------------------
    # App entry point — rendered receipt HTML for a chosen paper size
    # ------------------------------------------------------------------
    def get_dynamic_receipt_html(self, paper_size='80', paper_height=0):
        """Return this order's dynamic receipt as a self-contained HTML string.

        Called by the React Native app over JSON-RPC. The rendering itself is
        shared with account.move via the mixin — see _render_dynamic_html.
        """
        self.ensure_one()
        return self._render_dynamic_html('order_id', paper_size, paper_height)
