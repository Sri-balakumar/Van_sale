import logging

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)

# Defaults used when a company's settings record is first auto-created. The
# header title / footer text mirror the hardcoded strings the app's built-in
# receipt uses (src/utils/invoiceHtml.js), so an out-of-the-box dynamic invoice
# looks identical to the static one until the admin customises it.
DEFAULT_HEADER_TITLE = 'INVOICE / فاتورة'
DEFAULT_FOOTER_TEXT = 'Thank you for your purchase!\nشكرا لشرائك!'


class PosInvoiceSettings(models.Model):
    """Per-company branding for the dynamic POS invoice.

    One record per company (auto-created on demand via get_for_company). Every
    branding field is optional: a blank field falls back to the matching
    res.company value at render time, so the receipt is never worse than the
    static one even before the admin fills anything in.
    """
    _name = 'pos.invoice.settings'
    _description = 'POS Dynamic Invoice Settings'

    # No default company: on the Odoo "New" form the admin must pick a company
    # from the dropdown (so it won't preselect one that already has a record and
    # immediately trip the one-per-company constraint). get_for_company() and the
    # app always pass company_id explicitly, so they're unaffected.
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        ondelete='cascade', index=True,
    )

    # Master switch the app reads (via app_dynamic_enabled). OFF (default) means
    # the app keeps showing its normal built-in receipt even though this module
    # is installed; ON makes the app render this dynamic invoice. Lets a client
    # install the module but stay on the normal receipt until they opt in.
    use_dynamic_invoice = fields.Boolean(
        string='Use Dynamic Invoice on App', default=False,
        help='When off, the app shows its normal built-in receipt even though '
             'this module is installed. Turn on to render this dynamic invoice.',
    )

    # Template the app reads via app_dynamic_enabled:
    #   html      -> the app shows its normal built-in receipt (no server render)
    #   dynamic   -> the branded dynamic receipt (standard body)
    #   cash_memo -> the bilingual Oman Cash Memo invoice
    #   layout    -> the editable, block-based layout (per paper size)
    # `use_dynamic_invoice` is kept in sync (True for all non-html) for any
    # older readers.
    invoice_template = fields.Selection([
        ('html', 'Standard'),
        ('dynamic', 'Dynamic'),
        ('cash_memo', 'Cash Memo'),
        ('layout', 'Custom Layout (editable)'),
    ], string='Invoice Template', default='html')

    # --- Cash Memo header (bilingual Oman invoice; shown when the template is
    # 'cash_memo'). Defaults from the reference memo; each shop can edit them. ---
    company_name_ar = fields.Char(string='Company Name (Arabic)', default='منارة الخوض للأعمال ش ش و')
    # English company name for the Cash Memo header. Blank -> falls back to the
    # company's own name (res.company).
    company_name_en = fields.Char(string='Company Name (English)')
    cr_number = fields.Char(string='C.R. Number', default='1410246')
    po_box = fields.Char(string='P.O Box', default='112')
    postal_code = fields.Char(string='Postal Code', default='111')
    gsm = fields.Char(string='GSM / Mobile', default='77576196')
    vat_no = fields.Char(string='VAT Number')

    # Per-field show/hide for the Cash Memo header lines (both EN + AR columns).
    show_cm_name = fields.Boolean(string='Show Company Name', default=True)
    show_cm_cr = fields.Boolean(string='Show C.R. Number', default=True)
    show_cm_pobox = fields.Boolean(string='Show P.O Box', default=True)
    show_cm_postal = fields.Boolean(string='Show Postal Code', default=True)
    show_cm_sultanate = fields.Boolean(string='Show Sultanate of Oman', default=True)
    show_cm_gsm = fields.Boolean(string='Show GSM / Mobile', default=True)
    show_cm_vat = fields.Boolean(string='Show VAT Number', default=True)

    # --- Branding (each falls back to res.company when blank) ---
    address = fields.Text(string='Address', help='Free-text address; one line per row.')
    phone = fields.Char(string='Phone')
    email = fields.Char(string='Email')
    vat_number = fields.Char(string='VAT / GST Number')

    # --- Logo ---
    show_logo = fields.Boolean(string='Show Logo', default=True)
    logo = fields.Binary(string='Invoice Logo')

    # --- Text blocks ---
    header_title = fields.Char(string='Header Title', default=DEFAULT_HEADER_TITLE)
    footer_text = fields.Text(string='Footer Text', default=DEFAULT_FOOTER_TEXT)

    # --- Toggles ---
    show_tax = fields.Boolean(
        string='Show Tax Row', default=True,
        help='When off, the Tax line is hidden even if the order carries tax.',
    )
    show_customer_signature = fields.Boolean(
        string='Show Customer Signature', default=True,
        help='When off, the customer signature is hidden even if one was captured.',
    )
    show_shop_owner_signature = fields.Boolean(
        string='Show Cashier Signature', default=True,
        help='When off, the cashier signature is hidden even if one was captured.',
    )
    show_footer = fields.Boolean(
        string='Show Footer', default=True,
        help='When off, the footer text (e.g. "Thank you for your purchase!") is hidden.',
    )

    # --- Dynamic-header info lines (values shared with the Cash Memo fields:
    # cr_number / gsm; the Sultanate line is static text). Each line has its own
    # show/hide toggle so the DYNAMIC invoice header can carry the same company
    # info as the Cash Memo. Only the Dynamic template reads these — Standard
    # and Cash Memo are unaffected. ---
    show_dyn_cr = fields.Boolean(
        string='Show C.R. Number', default=True,
        help='Show the C.R. Number line on the Dynamic invoice header.',
    )
    show_dyn_gsm = fields.Boolean(
        string='Show GSM / Mobile', default=True,
        help='Show the GSM / Mobile line on the Dynamic invoice header.',
    )
    show_dyn_sultanate = fields.Boolean(
        string='Show Sultanate of Oman', default=True,
        help='Show the "Sur-Sultanate of Oman" line on the Dynamic invoice header.',
    )
    show_dyn_vat = fields.Boolean(
        string='Show VAT Line', default=True,
        help='Show the VAT / GST line on the Dynamic invoice header.',
    )
    show_dyn_name_ar = fields.Boolean(
        string='Show Arabic Company Name', default=True,
        help='Show the Arabic company name (shared with the Cash Memo) above '
             'the company name on the Dynamic invoice header.',
    )
    show_dyn_customer_details = fields.Boolean(
        string='Show Full Customer Details', default=False,
        help='Dynamic invoice: off = customer name + mobile only; on = also '
             'the customer address, VAT number and email.',
    )

    # --- Default receipt size (applies to BOTH the dynamic and the normal
    # receipt) ---
    # When on, the app skips its paper-size prompt on Preview / Download / Print
    # and renders at `default_paper_size_id` (mm). Independent of use_dynamic_invoice
    # so it works even when the app is on its built-in receipt.
    use_default_paper_size = fields.Boolean(
        string='Use Default Receipt Size', default=False,
        help='When on, the app prints at the size below without asking each time. '
             'Applies whether the app shows the dynamic or the normal receipt.',
    )
    # The default receipt size is now a RECORD (pos.invoice.paper.size), so a shop
    # can add its own sizes (e.g. "8 inch") — not just edit the fixed six. The
    # record carries the editable mm; `key` on it stays stable across renames.
    default_paper_size_id = fields.Many2one(
        'pos.invoice.paper.size', string='Default Receipt Size',
        domain="[('company_id', '=', company_id)]", ondelete='restrict',
        help='Pick the size the app prints at. Manage the list of sizes — '
             'including your own — from Paper Sizes.',
    )

    # Live indicator of the resolved size — updates as the picked size's mm change.
    default_size_hint = fields.Char(compute='_compute_default_size_hint', string='Selected')

    def _resolved_default(self):
        """Return (width_mm, height_mm) for the selected default size.

        Reads the linked pos.invoice.paper.size record; falls back to 80mm/auto
        when nothing is selected, matching the historic behaviour.
        """
        self.ensure_one()
        size = self.default_paper_size_id
        if size:
            return (size.width_mm or 80, size.height_mm or 0)
        return (80, 0)

    def _preset_list(self):
        """[{key,label,mm}] the app uses to render its size picker.

        Excludes the 'Custom' record so the JSON stays the historic 6-entry
        shape; a shop's own extra sizes DO appear (appended).
        """
        self.ensure_one()
        sizes = self.env['pos.invoice.paper.size'].sudo().search([
            ('company_id', '=', self.company_id.id), ('is_custom', '=', False),
        ])
        return [
            {'key': s.key, 'label': s.name, 'mm': int(s.width_mm or 0)}
            for s in sizes
        ]

    @api.depends('default_paper_size_id',
                 'default_paper_size_id.width_mm', 'default_paper_size_id.height_mm')
    def _compute_default_size_hint(self):
        for rec in self:
            w, h = rec._resolved_default()
            rec.default_size_hint = ('→ %d × %d mm' % (w, h)) if h else ('→ %d mm' % w)

    def action_edit_layout(self):
        """Open the visual layout editor for the current default paper size, so
        the admin can jump straight from Invoice Settings into editing (no need to
        hunt for the Invoice Layouts menu)."""
        self.ensure_one()
        size = self.default_paper_size_id
        if not size:
            Size = self.env['pos.invoice.paper.size'].sudo()
            size = Size.search([('company_id', '=', self.company_id.id)], limit=1)
        layout = self.env['pos.invoice.layout'].resolve_for(self.company_id, size)
        return layout.action_open_editor()

    @api.model
    def action_open_company_settings(self):
        """Open the single settings FORM for the current company directly (not the
        list), so the 'Invoice Settings' menu lands on the editable form with the
        Preview / Edit Layout buttons."""
        rec = self.get_for_company(self.env.company)
        return {
            'type': 'ir.actions.act_window',
            'name': _('Invoice Settings'),
            'res_model': 'pos.invoice.settings',
            'view_mode': 'form',
            'res_id': rec.id,
            'target': 'current',
        }

    def action_manage_paper_sizes(self):
        """Open the per-company list of paper sizes so the admin can add/edit."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Paper Sizes'),
            'res_model': 'pos.invoice.paper.size',
            'view_mode': 'list,form',
            'domain': [('company_id', '=', self.company_id.id)],
            'context': {'default_company_id': self.company_id.id},
        }

    _sql_constraints = [
        ('company_uniq', 'unique(company_id)',
         'There can only be one dynamic invoice settings record per company.'),
    ]

    @api.model
    def get_for_company(self, company=None):
        """Return the settings record for `company` (defaults to the current
        company), creating it with defaults if it doesn't exist, so templates
        can always assume a record exists.
        """
        company = company or self.env.company
        # Ensure this company has its paper sizes (factory six + custom).
        self.env['pos.invoice.paper.size'].sudo().seed_for_company(company)
        record = self.sudo().search([('company_id', '=', company.id)], limit=1)
        if not record:
            record = self.sudo().create({'company_id': company.id})
        if not record.default_paper_size_id:
            # Default to 3.5 inch (the historic '35in' default), else the first.
            Size = self.env['pos.invoice.paper.size'].sudo()
            default = Size.search([
                ('company_id', '=', company.id), ('key', '=', '35in'),
            ], limit=1) or Size.search([('company_id', '=', company.id)], limit=1)
            record.default_paper_size_id = default
        record._seed_header_fields()
        return record

    def _seed_header_fields(self):
        """Create the default Company-Header rows (C.R. No, GSM, Sur-Sultanate, VAT)
        once per company, from the current branding values. After this, the header
        table is driven by these editable/reorderable rows (see the visual editor)."""
        self.ensure_one()
        HF = self.env['pos.invoice.header.field'].sudo()
        if HF.search_count([('company_id', '=', self.company_id.id)]):
            return
        seed = []
        if self.cr_number:
            seed.append(('C.R. No', 'السجل التجاري', self.cr_number))
        if self.gsm:
            seed.append(('GSM', 'الهاتف', self.gsm))
        seed.append(('Sur-Sultanate of Oman', 'العنوان : سلطنة عمان', ''))
        vat = self.vat_number or (self.company_id.partner_id.vat or '')
        if vat:
            seed.append(('VAT No', 'الرقم الضريبي', vat))
        for i, (le, la, v) in enumerate(seed):
            HF.create({
                'company_id': self.company_id.id, 'sequence': (i + 1) * 10,
                'label_en': le, 'label_ar': la, 'value': v,
            })

    # Keep the legacy `use_dynamic_invoice` flag in sync with the 3-way template
    # so any older reader still works: on = Dynamic or Cash Memo, off = Normal.
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('invoice_template'):
                vals['use_dynamic_invoice'] = vals['invoice_template'] != 'html'
        return super().create(vals_list)

    def write(self, vals):
        if 'invoice_template' in vals:
            vals = dict(vals, use_dynamic_invoice=(vals['invoice_template'] != 'html'))
        return super().write(vals)

    @api.model
    def app_dynamic_enabled(self):
        """Return True when the mobile app should fetch a server-rendered invoice
        for the current company. Now True for ALL templates (Standard included):
        the server's Standard render is a same-look port of the app's built-in
        receipt, and rendering it server-side lets the Invoice Settings logo
        appear on the Standard receipt too. The app's built-in receipt remains
        the offline fallback (fetch failure -> generateInvoiceHtml).
        """
        self.get_for_company(self.env.company)  # ensure the settings record exists
        return True

    @api.model
    def app_paper_size(self):
        """Per-company default receipt size for the mobile app.

        Returns {'use_default': bool, 'size': '80'}: when use_default is on the
        app skips its paper-size prompt on Preview / Download / Print and renders
        at `size` (mm). Company-scoped like app_dynamic_enabled, and independent
        of use_dynamic_invoice so it applies to BOTH the dynamic and the normal
        receipt. A missing model (module absent) makes the RPC error and the app
        falls back to asking each time.
        """
        rec = self.get_for_company(self.env.company)
        width, height = rec._resolved_default()
        result = {
            'use_default': bool(rec.use_default_paper_size),
            'size': str(width),
            'height': int(height),
            # Configured mm for each preset so the app's ad-hoc size picker
            # reflects any edits the admin made.
            'presets': rec._preset_list(),
        }
        _logger.info('[PAPER SIZE] app_paper_size -> %s', result)
        return result

    def action_preview_receipt(self):
        """Header 'Preview' button: render the currently selected template
        against the most recent order for this company, so the admin can see
        the invoice from the settings form itself. Odoo saves the (dirty) form
        before running this object button, so the preview reflects the picked
        template and header fields."""
        self.ensure_one()
        company = self.company_id or self.env.company
        PosOrder = self.env['pos.order']
        # Prefer a real sale (positive total) so the sample doesn't show a
        # negative refund; fall back to any order if that's all there is.
        order = PosOrder.search(
            [('company_id', '=', company.id), ('amount_total', '>', 0)],
            order='date_order desc', limit=1)
        if not order:
            order = PosOrder.search(
                [('company_id', '=', company.id)],
                order='date_order desc', limit=1)
        if not order:
            raise UserError(_(
                'Make at least one sale for %s before previewing the invoice.',
                company.display_name))
        return order.action_open_dynamic_receipt_preview()

    @api.constrains('company_id')
    def _check_one_per_company(self):
        """Enforce a single settings record per company. Odoo 19 ignored the
        old _sql_constraints unique(company_id), which let a duplicate slip in;
        this ORM-level guard blocks it in all versions (e.g. reassigning another
        company's record to one that already has settings)."""
        for record in self:
            if not record.company_id:
                continue
            others = self.sudo().search_count([
                ('company_id', '=', record.company_id.id),
                ('id', '!=', record.id),
            ])
            if others:
                raise ValidationError(
                    "There is already a Dynamic Invoice Settings record for "
                    "company '%s'. Only one is allowed per company." % record.company_id.display_name
                )
