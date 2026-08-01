import base64
import re

from odoo import models
from odoo.tools.image import image_process


class DynamicReceiptMixin(models.AbstractModel):
    """Everything the dynamic receipt needs that is NOT specific to pos.order.

    The QWeb templates never touch a record — they read the plain dict returned
    by `get_dynamic_receipt_data()` (plus `layout` and the size CSS, assembled
    by the wizard). So any model that can build that dict renders through all
    four templates (Standard / Dynamic / Cash Memo / Custom Layout) unchanged.

    That is what this mixin is for: `pos.order` and `account.move` each supply
    their own `_base_receipt_data()`, while the money/ref/logo/barcode helpers,
    the Customer Due computation and the whole pos.invoice.settings branding
    layer live here once.

    A model using this mixin MUST implement `_base_receipt_data()`. The
    `_receipt_*` hooks below have safe defaults and only need overriding where
    the two models genuinely differ (paid amount, barcode source, refunds, and
    which move to exclude from the customer's previous due).
    """
    _name = 'pos.dynamic.receipt.mixin'
    _description = 'Dynamic Receipt Rendering Mixin'

    # ------------------------------------------------------------------
    # Per-model hooks
    # ------------------------------------------------------------------
    def _base_receipt_data(self):
        """Build the receipt dict from record data only (no branding)."""
        raise NotImplementedError

    def _receipt_amount_paid(self):
        """Amount already received against this document."""
        return 0.0

    def _receipt_barcode_value(self):
        """Value encoded into the barcode block."""
        self.ensure_one()
        return self.display_name or str(self.id)

    def _receipt_refunded_amount(self):
        """Positive refunded amount, or 0 when this is not a refund."""
        return 0.0

    def _receipt_show_signature_block(self):
        """Whether to print the signature area at all.

        True for documents someone signs on handover (a POS sale), False for
        those that are never signed. Distinct from `show_customer_sig`, which
        controls the signature IMAGE — this controls the blank ruled lines the
        Cash Memo prints for signing by hand.
        """
        return True

    def _receipt_excluded_move(self):
        """The move to leave OUT of the customer's previous due.

        For a pos.order that is its linked invoice; for an account.move it is
        the move itself. Without this the document's own receivable would be
        counted twice — once as "Previous Due" and again as "This Invoice".
        """
        return self.env['account.move']

    # ------------------------------------------------------------------
    # Money / ref / logo / barcode helpers
    # ------------------------------------------------------------------
    def _receipt_money_formatter(self):
        """Return fn(amount) -> 'symbol 0.000', matching formatCurrencyHtml."""
        currency = self.currency_id or self.company_id.currency_id
        digits = currency.decimal_places if currency else 2
        symbol = (currency.symbol or currency.name or '') if currency else ''

        def _fmt(amount):
            try:
                value = float(amount or 0.0)
            except (TypeError, ValueError):
                value = 0.0
            text = ('{:.%df}' % digits).format(value)
            return ('%s %s' % (symbol, text)) if symbol else text

        return _fmt

    @staticmethod
    def _extract_order_ref(order_name, order_id):
        """Port of extractOrderRef: trailing digits of the name, else padded id."""
        if order_name:
            match = re.search(r'(\d+)\s*$', str(order_name))
            if match:
                return match.group(1)
        return str(order_id or '').rjust(6, '0')

    @staticmethod
    def _receipt_logo_b64(settings):
        """Settings logo as a base64 PNG string, downscaled to a 512px box.

        The receipt shows it at most ~90px tall, so 512px stays crisp for
        screen + print while cutting a multi-MB original down to tens of KB
        (a full-res logo otherwise bloats every receipt and can hang on-device
        PDF generation). Binary fields hold base64, but image_process wants raw
        bytes: decode -> resize -> PNG re-encode -> base64. Aspect ratio is
        preserved; any processing error falls back to the original image.
        Returns '' when no logo is set."""
        raw_logo = settings.logo
        if not raw_logo:
            return ''
        logo_b64 = raw_logo
        try:
            resized = image_process(base64.b64decode(raw_logo), size=(512, 512), output_format='PNG')
            logo_b64 = base64.b64encode(resized)
        except Exception:
            logo_b64 = raw_logo
        return (logo_b64.decode() if isinstance(logo_b64, bytes) else logo_b64) or ''

    def _receipt_barcode_b64(self, btype, value):
        """A barcode/QR as a base64 PNG string, self-contained + thermal-safe
        (pure black). Uses Odoo's built-in generator; any failure or missing
        value returns '' so the block simply falls back to text / hides."""
        if not value:
            return ''
        try:
            kw = {'width': 600, 'height': 600, 'humanreadable': 0} if btype == 'QR' \
                else {'width': 600, 'height': 120, 'humanreadable': 0}
            img = self.env['ir.actions.report'].barcode(btype, value, **kw)
            return base64.b64encode(img).decode() if img else ''
        except Exception:
            return ''

    # ------------------------------------------------------------------
    # Customer Due — what the customer owed BEFORE this document
    # ------------------------------------------------------------------
    def _partner_previous_due(self):
        """Open (unreconciled) residual on the partner's posted receivable
        lines, excluding this document's own move.

        Scoped to the partner and the company, using the same account-type
        convention as the app's Partner Ledger screen, so the printed figure
        and the ledger can never disagree. Returns 0.0 with no partner (a
        walk-in sale has nothing to carry forward).
        """
        self.ensure_one()
        if not self.partner_id:
            return 0.0
        domain = [
            ('partner_id', '=', self.partner_id.id),
            ('company_id', '=', (self.company_id or self.env.company).id),
            ('account_id.account_type', '=', 'asset_receivable'),
            ('parent_state', '=', 'posted'),
            ('reconciled', '=', False),
        ]
        excluded = self._receipt_excluded_move()
        if excluded:
            domain.append(('move_id', '!=', excluded.id))
        lines = self.env['account.move.line'].sudo().search_read(domain, ['amount_residual'])
        return sum(float(line.get('amount_residual') or 0.0) for line in lines)

    # ------------------------------------------------------------------
    # Dynamic payload — base data + admin settings branding
    # ------------------------------------------------------------------
    def get_dynamic_receipt_data(self):
        """Base receipt data with pos.invoice.settings branding layered on top.

        Every branding override is fallback-safe: a blank settings field leaves
        the res.company-derived value in place.
        """
        self.ensure_one()
        return self._apply_receipt_settings(self._base_receipt_data())

    def _apply_receipt_settings(self, data):
        """Layer the per-company Invoice Settings onto a base receipt dict."""
        self.ensure_one()
        company = self.company_id or self.env.company
        settings = self.env['pos.invoice.settings'].get_for_company(company)

        # Common keys the dispatcher + Cash Memo template read (present in EVERY
        # branch, including the normal-mode early return below).
        data['invoice_template'] = settings.invoice_template
        data['company_name_ar'] = settings.company_name_ar or ''
        # Custom English name for the Cash Memo; blank -> the company's own name.
        data['company_name_en'] = settings.company_name_en or company.name or ''
        data['cr_number'] = settings.cr_number or ''
        data['po_box'] = settings.po_box or ''
        data['postal_code'] = settings.postal_code or ''
        data['gsm_mobile'] = settings.gsm or ''
        data['vat_no'] = settings.vat_no or ''
        data['show_cm_name'] = settings.show_cm_name
        data['show_cm_cr'] = settings.show_cm_cr
        data['show_cm_pobox'] = settings.show_cm_pobox
        data['show_cm_postal'] = settings.show_cm_postal
        data['show_cm_sultanate'] = settings.show_cm_sultanate
        data['show_cm_gsm'] = settings.show_cm_gsm
        data['show_cm_vat'] = settings.show_cm_vat
        # Dynamic-header info-line toggles (read by the standard_doc template in
        # DYNAMIC mode only; the normal-mode branch below forces them off so the
        # plain Standard receipt stays unchanged).
        data['show_dyn_cr'] = settings.show_dyn_cr
        data['show_dyn_gsm'] = settings.show_dyn_gsm
        data['show_dyn_sultanate'] = settings.show_dyn_sultanate
        data['show_dyn_vat'] = settings.show_dyn_vat
        data['show_dyn_name_ar'] = settings.show_dyn_name_ar
        currency = self.currency_id or company.currency_id
        fmt = self._receipt_money_formatter()
        amount_total = float(self.amount_total or 0.0)
        amount_paid = float(self._receipt_amount_paid() or 0.0)
        try:
            data['amount_in_words'] = currency.amount_to_text(amount_total)
        except Exception:
            data['amount_in_words'] = ''
        data['advance_f'] = fmt(amount_paid)
        this_due = amount_total - amount_paid
        data['due_f'] = fmt(this_due)
        # Customer Due block: what they owed before + what this document leaves
        # unpaid + the new running total. Hidden entirely when nothing is owed,
        # so a settled customer's receipt is unchanged.
        prev_due = self._partner_previous_due()
        total_due = prev_due + this_due
        data['prev_due_f'] = fmt(prev_due)
        data['this_due_f'] = fmt(this_due)
        data['total_due_f'] = fmt(total_due)
        # Round to the currency before deciding whether to show the block, so a
        # sub-cent rounding residue can't print a "Total Due" of 0.000.
        rounded_due = currency.round(total_due) if currency else round(total_due, 2)
        data['show_customer_due'] = bool(self.partner_id) and rounded_due > 0
        partner = self.partner_id
        data['customer_address'] = ', '.join(
            p for p in [getattr(partner, 'street', ''), getattr(partner, 'street2', ''), getattr(partner, 'city', '')] if p
        ) if partner else ''

        # Layout blocks: barcode + QR as self-contained base64 (thermal-safe),
        # and a refunded row. All optional — a block only shows when present.
        data['barcode_value'] = self._receipt_barcode_value()
        data['barcode_img'] = self._receipt_barcode_b64('Code128', data['barcode_value'])
        data['qr_img'] = self._receipt_barcode_b64('QR', company.website or data['barcode_value'])
        refunded = float(self._receipt_refunded_amount() or 0.0)
        data['refunded_f'] = fmt(refunded)
        data['show_refunded'] = bool(refunded)
        # Whether the signature AREA prints at all — the Cash Memo draws blank
        # ruled lines for signing by hand, which make no sense on a document
        # that is never signed (see _receipt_show_signature_block).
        data['show_signature_block'] = self._receipt_show_signature_block()

        # NORMAL MODE (switch OFF): render the plain receipt — the same look as
        # the app's built-in HTML receipt (res.company details, default title/
        # footer, no VAT line, no terms). The Invoice Settings LOGO now shows on
        # the Standard receipt too (same as Dynamic / Cash Memo); everything
        # else stays plain.
        if not settings.use_dynamic_invoice:
            data['vat_number'] = ''
            # Dynamic-only header lines never show on the plain Standard receipt.
            data['show_dyn_cr'] = False
            data['show_dyn_gsm'] = False
            data['show_dyn_sultanate'] = False
            data['show_dyn_vat'] = False
            data['show_dyn_name_ar'] = False
            data['show_logo'] = bool(settings.show_logo and settings.logo)
            data['logo'] = self._receipt_logo_b64(settings)
            data['header_title'] = 'INVOICE / فاتورة'
            data['footer_text'] = 'Thank you for your purchase!\nشكرا لشرائك!'
            data['footer_lines'] = data['footer_text'].split('\n')
            data['show_customer_sig'] = bool(data.get('customer_signature'))
            data['show_shop_owner_sig'] = bool(data.get('shop_owner_signature'))
            data['show_footer'] = True
            return data

        block = data['company']
        # Company name always comes from res.company (no separate brand field).
        if settings.address:
            block['address_lines'] = [line for line in settings.address.splitlines() if line.strip()]
        if settings.phone:
            block['phone'] = settings.phone
        if settings.email:
            block['email'] = settings.email

        data['vat_number'] = settings.vat_number or company.vat or ''
        data['show_logo'] = bool(settings.show_logo and settings.logo)
        data['logo'] = self._receipt_logo_b64(settings)
        data['header_title'] = settings.header_title or 'INVOICE / فاتورة'
        data['footer_text'] = settings.footer_text or 'Thank you for your purchase!\nشكرا لشرائك!'
        data['footer_lines'] = (data['footer_text'] or '').split('\n')
        # Combine the admin toggle with the order actually carrying tax.
        data['show_tax'] = bool(settings.show_tax and data.get('show_tax'))
        # Per-side signature toggles: show a signature only when its toggle is
        # on AND one was actually captured for that side.
        data['show_customer_sig'] = bool(settings.show_customer_signature and data.get('customer_signature'))
        data['show_shop_owner_sig'] = bool(settings.show_shop_owner_signature and data.get('shop_owner_signature'))
        data['show_footer'] = bool(settings.show_footer and data.get('footer_text'))
        return data

    # ------------------------------------------------------------------
    # App entry point — rendered receipt HTML for a chosen paper size
    # ------------------------------------------------------------------
    def _render_dynamic_html(self, wizard_field, paper_size='80', paper_height=0):
        """Return the dynamic receipt as a self-contained HTML string for
        `paper_size` (mm width) and optional `paper_height` (mm; 0 = auto).

        Renders ONLY the receipt body template (inline <style> + base64 images,
        no /web/assets bundles) wrapped in a minimal <html> document, so the app
        prints/downloads it instantly. The backend report (report_action) is a
        separate wrapper that adds web.basic_layout for the in-Odoo preview — we
        deliberately don't use it here because its asset <link>/<script> tags
        never load on-device and hang the print engine.
        """
        self.ensure_one()
        try:
            height = int(paper_height or 0)
        except (TypeError, ValueError):
            height = 0
        # The app always sends a numeric width (mm) — presets are resolved to
        # their configured mm server-side. Always render via the custom path so
        # any width works (the wizard Selection only knows the fixed presets).
        try:
            width = int(paper_size)
        except (TypeError, ValueError):
            width = 80
        wizard = self.env['pos.dynamic.invoice.wizard'].create({
            wizard_field: self.id,
            'paper_size': 'custom',
            'custom_width': width,
            'custom_height': height,
        })
        values = wizard._render_context()
        body = self.env['ir.qweb']._render('pos_dynamic_invoice.report_pos_dynamic_invoice_doc', values)
        body = body.decode() if isinstance(body, bytes) else body
        return (
            '<!doctype html><html><head><meta charset="utf-8"/>'
            '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
            '</head><body style="margin:0;padding:0;">%s</body></html>' % body
        )
