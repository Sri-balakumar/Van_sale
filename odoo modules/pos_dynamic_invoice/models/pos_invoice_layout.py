from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

# The fixed catalog of blocks a receipt is built from. Order here is only the
# palette order; the actual on-receipt order is the (row, col) of each block.
BLOCK_TYPES = [
    ('logo', 'Logo'),
    ('company_name_en', 'Company Name (English)'),
    ('company_name_ar', 'Company Name (Arabic)'),
    ('header_info', 'Company Header'),
    ('title', 'Title'),
    ('meta_fields', 'Order Fields (No / Date / Customer)'),
    ('items_table', 'Items Table'),
    ('totals', 'Totals'),
    ('payments', 'Payments'),
    ('customer_due', 'Customer Due'),
    ('signatures', 'Signatures'),
    ('footer', 'Footer'),
    ('barcode', 'Barcode'),
    ('qrcode', 'QR Code'),
    ('custom_text', 'Custom Text'),
]


class PosInvoiceLayout(models.Model):
    """A per-(company, paper size, template kind) receipt layout, expressed as an
    ordered grid of blocks.

    This is the data an editor edits and the renderer walks — the layout-driven
    third template branch, added ALONGSIDE the existing hardcoded Dynamic and
    Cash Memo templates (which stay untouched). One layout per paper size means a
    50mm roll and an A4 sheet can look genuinely different.
    """
    _name = 'pos.invoice.layout'
    _description = 'POS Invoice Layout'
    _order = 'company_id, id'

    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        ondelete='cascade', index=True, default=lambda s: s.env.company,
    )
    paper_size_id = fields.Many2one(
        'pos.invoice.paper.size', string='Paper Size', required=True,
        ondelete='cascade', index=True,
        domain="[('company_id', '=', company_id)]",
        help='This layout applies when this paper size is used. A user-created '
             'size (e.g. 8 inch) automatically gets its own layout.',
    )
    # Informational only (which built-in look the defaults were seeded from);
    # NOT part of the key — v1 is one layout per (company, paper size).
    base_style = fields.Selection(
        [('dynamic', 'Dynamic'), ('cash_memo', 'Cash Memo')],
        string='Base Style', default='dynamic',
    )
    name = fields.Char(string='Name', required=True, default='Layout')
    active = fields.Boolean(string='Active', default=True)
    block_ids = fields.One2many('pos.invoice.layout.block', 'layout_id', string='Blocks')

    # Positioning mode: 'flow' = stacked rows (default, safe on any length);
    # 'grid' = free placement on a 1cm grid (Softify-style).
    positioning = fields.Selection(
        [('flow', 'Flow (stacked)'), ('grid', 'Grid (free placement)')],
        string='Positioning', default='flow', required=True,
    )
    canvas_h_cm = fields.Integer(string='Canvas Height (cm)', default=40)

    # Live preview (Phase 1.3) — computed HTML shown via widget="iframe_wrapper".
    preview = fields.Html(string='Preview', compute='_compute_preview', sanitize=False)

    _sql_constraints = [
        ('layout_uniq', 'unique(company_id, paper_size_id)',
         'A layout already exists for this company and paper size.'),
    ]

    @api.constrains('company_id', 'paper_size_id')
    def _check_one_per_size(self):
        """ORM guard: Odoo 19 doesn't reliably enforce the unique _sql_constraint
        (same issue as pos.invoice.settings), which let DUPLICATE layouts per size
        slip in — the editor and renderer then resolved different copies. Block it
        here in all versions."""
        for rec in self:
            if rec.company_id and rec.paper_size_id:
                dup = self.sudo().search([
                    ('company_id', '=', rec.company_id.id),
                    ('paper_size_id', '=', rec.paper_size_id.id),
                    ('id', '!=', rec.id),
                ], limit=1)
                if dup:
                    raise ValidationError(_(
                        'A layout already exists for this company and paper size.'))

    @api.model
    def resolve_for(self, company, paper_size):
        """Return the layout for (company, paper_size), creating + seeding a
        default one if absent. Central resolver used by the render path."""
        if not paper_size:
            return self.browse()
        layout = self.sudo().search([
            ('company_id', '=', company.id), ('paper_size_id', '=', paper_size.id),
        ], limit=1)
        if not layout:
            layout = self.sudo().create({
                'company_id': company.id, 'paper_size_id': paper_size.id,
                'name': paper_size.name,
            })
            layout._seed_default_blocks()
        return layout

    def _seed_default_blocks(self):
        """Populate a fresh layout with the default block arrangement mirroring
        today's Dynamic receipt: a single-column vertical stack, except the two
        meta rows which are two columns (customer|cashier, date|no)."""
        self.ensure_one()
        if self.block_ids:
            return
        Block = self.env['pos.invoice.layout.block'].sudo()
        # (row, col, width_pct, block_type, extra)
        spec = [
            (0, 0, 100, 'logo', {}),
            (1, 0, 100, 'company_name_ar', {}),
            (2, 0, 100, 'company_name_en', {}),
            (3, 0, 100, 'header_info', {}),
            (4, 0, 100, 'title', {}),
            (5, 0, 100, 'meta_fields', {}),
            (6, 0, 100, 'items_table', {}),
            (7, 0, 100, 'totals', {}),
            (8, 0, 100, 'payments', {}),
            (9, 0, 100, 'customer_due', {}),
            (10, 0, 100, 'signatures', {}),
            (11, 0, 100, 'footer', {}),
        ]
        for row, col, width, btype, extra in spec:
            Block.create(dict(
                layout_id=self.id, row=row, col=col, width_pct=width,
                block_type=btype, **extra,
            ))

    @api.depends('block_ids', 'block_ids.row', 'block_ids.col', 'block_ids.width_pct',
                 'block_ids.visible', 'block_ids.block_type', 'block_ids.align',
                 'block_ids.font_size_px', 'block_ids.logo_width_pct',
                 'block_ids.label_en', 'block_ids.label_ar', 'block_ids.direction',
                 'block_ids.bold', 'block_ids.content_en', 'block_ids.content_ar',
                 'block_ids.grid_x', 'block_ids.grid_y', 'block_ids.grid_w', 'block_ids.grid_h',
                 'positioning', 'canvas_h_cm',
                 'paper_size_id.width_mm', 'paper_size_id.height_mm')
    def _compute_preview(self):
        """Render the layout against the newest order, for a live in-form preview
        (shown via widget="iframe_wrapper"). Mirrors web's base.document.layout."""
        for rec in self:
            rec.preview = rec._render_preview_body()

    def _render_preview_body(self):
        """Fresh preview HTML for this layout (shared by the computed field and the
        editor's live refresh)."""
        self.ensure_one()
        from ..wizard.pos_dynamic_invoice_wizard import compute_size_css
        Order = self.env['pos.order']
        order = (Order.search([('company_id', '=', self.company_id.id)],
                              order='id desc', limit=1)
                 or Order.search([], order='id desc', limit=1))
        if not order or not self.paper_size_id:
            return False
        ctx = compute_size_css(self.paper_size_id.width_mm, self.paper_size_id.height_mm)
        ctx['d'] = order.get_dynamic_receipt_data()
        ctx['layout'] = self
        body = self.env['ir.qweb']._render(
            'pos_dynamic_invoice.report_pos_invoice_layout_doc', ctx)
        return (
            '<!doctype html><html><head><meta charset="utf-8"/></head>'
            '<body style="margin:0;padding:0;">%s</body></html>' % body
        )

    def render_preview_html(self):
        """RPC for the editor: always render fresh so EVERY change (block fields
        AND company header settings) reflects immediately in the live preview."""
        self.ensure_one()
        return self._render_preview_body() or (
            "<html><body style='font-family:sans-serif;padding:20px;color:#888'>"
            "No preview (no order to render yet).</body></html>")

    # Company header data fields, edited from the editor Options panel; they live
    # on pos.invoice.settings (company-wide).
    _HEADER_FIELDS = [
        'company_name_en', 'company_name_ar', 'cr_number', 'gsm', 'vat_no',
        'po_box', 'postal_code', 'address', 'phone', 'email',
    ]

    def header_settings(self):
        """RPC: current company-header field values for the Options panel."""
        self.ensure_one()
        s = self.env['pos.invoice.settings'].get_for_company(self.company_id)
        return {f: (getattr(s, f) or '') for f in self._HEADER_FIELDS}

    def set_header_setting(self, field, value):
        """RPC: write a company-header field from the Options panel."""
        self.ensure_one()
        if field in self._HEADER_FIELDS:
            s = self.env['pos.invoice.settings'].get_for_company(self.company_id)
            s.sudo().write({field: value})
        return True

    # ---- Company Header dynamic fields (reorderable + custom) ----
    def _header_field_model(self):
        return self.env['pos.invoice.header.field'].sudo()

    def header_field_rows(self):
        """Recordset of the company's VISIBLE header fields, in order — used by the
        renderer to build the bilingual header table."""
        self.ensure_one()
        # make sure the defaults exist (covers brand-new companies)
        self.env['pos.invoice.settings'].get_for_company(self.company_id)
        return self._header_field_model().search(
            [('company_id', '=', self.company_id.id), ('visible', '=', True)],
            order='sequence, id')

    def header_fields(self):
        """RPC: all header fields for the Options panel (incl. hidden)."""
        self.ensure_one()
        self.env['pos.invoice.settings'].get_for_company(self.company_id)
        recs = self._header_field_model().search(
            [('company_id', '=', self.company_id.id)], order='sequence, id')
        return [{
            'id': f.id, 'label_en': f.label_en or '', 'label_ar': f.label_ar or '',
            'value': f.value or '', 'visible': f.visible,
        } for f in recs]

    def add_header_field(self):
        """RPC: create a blank header field the user then fills in."""
        self.ensure_one()
        HF = self._header_field_model()
        existing = HF.search([('company_id', '=', self.company_id.id)])
        seq = (max(existing.mapped('sequence') or [0]) + 10)
        rec = HF.create({
            'company_id': self.company_id.id, 'sequence': seq,
            'label_en': 'New Field', 'label_ar': '', 'value': '',
        })
        return rec.id

    def write_header_field(self, field_id, vals):
        """RPC: edit one header field's label/value/visibility."""
        self.ensure_one()
        allowed = {k: v for k, v in (vals or {}).items()
                   if k in ('label_en', 'label_ar', 'value', 'visible')}
        if allowed:
            self._header_field_model().browse(field_id).write(allowed)
        return True

    def move_header_field(self, field_id, direction):
        """RPC: move a header field up/down (swap with its neighbour)."""
        self.ensure_one()
        HF = self._header_field_model()
        recs = HF.search([('company_id', '=', self.company_id.id)], order='sequence, id')
        ids = recs.ids
        if field_id not in ids:
            return False
        # renumber to guarantee distinct, ordered sequences, then swap the pair
        for k, r in enumerate(recs):
            r.sequence = (k + 1) * 10
        i = ids.index(field_id)
        j = i - 1 if direction == 'up' else i + 1
        if j < 0 or j >= len(ids):
            return False
        recs[i].sequence, recs[j].sequence = recs[j].sequence, recs[i].sequence
        return True

    def del_header_field(self, field_id):
        """RPC: remove a header field."""
        self.ensure_one()
        self._header_field_model().browse(field_id).unlink()
        return True

    def action_open_editor(self):
        """Open the drag-and-drop visual editor (OWL client action) for this
        layout."""
        self.ensure_one()
        if not self.block_ids:
            self._seed_default_blocks()
        return {
            'type': 'ir.actions.client',
            'tag': 'pos_invoice_layout_editor',
            'name': _('Layout Editor'),
            'context': {'layout_id': self.id},
            'params': {'layout_id': self.id},
        }

    # cm heights used when first seeding grid coordinates from the flow order.
    # Tighter heights so grid boxes hug their content (less empty gap).
    _GRID_DEFAULT_H = {
        'logo': 2.5, 'company_name_ar': 1, 'company_name_en': 1,
        'header_info': 3.5, 'title': 1.5, 'meta_fields': 2,
        'items_table': 6, 'totals': 3, 'payments': 2, 'signatures': 2.5,
        'footer': 1.5, 'barcode': 2, 'qrcode': 3, 'custom_text': 2,
    }

    def action_reset_default(self):
        """Restore a clean, gap-free default: flow layout, factory blocks. Called
        from the editor's 'Reset to Default' button (per size)."""
        self.ensure_one()
        self.block_ids.sudo().unlink()
        self.sudo().positioning = 'flow'
        self._seed_default_blocks()
        return True

    def set_positioning(self, mode):
        """Called from the editor to switch flow<->grid. On the first switch to
        grid, seed each block's grid coords from its current stacked order so the
        canvas opens looking like the receipt."""
        self.ensure_one()
        self.sudo().positioning = mode
        if mode == 'grid' and not any(b.grid_w for b in self.block_ids):
            self._seed_grid_coords()
        return True

    def _seed_grid_coords(self):
        """Full-width, stacked-by-order starting grid (whole cm)."""
        self.ensure_one()
        width_cm = max(2, round((self.paper_size_id.width_mm or 80) / 10.0))
        y = 0
        for b in self.block_ids.sorted(lambda x: (x.row, x.col, x.id)):
            h = self._GRID_DEFAULT_H.get(b.block_type, 3)
            b.sudo().write({'grid_x': 0, 'grid_y': y, 'grid_w': width_cm, 'grid_h': h})
            y += h

    def render_grid_h_cm(self):
        """Height (cm) the grid canvas needs to fit its content: the lowest VISIBLE
        block's bottom edge + a small margin. Used instead of the fixed
        canvas_h_cm so the paper hugs the content — no wasted white space below the
        footer, and it grows when a block is dragged/resized lower."""
        self.ensure_one()
        bottom = 0.0
        for b in self.block_ids:
            if b.visible:
                bt = (b.grid_y or 0.0) + (b.grid_h or 2.0)
                if bt > bottom:
                    bottom = bt
        return round(max(3.0, bottom + 0.5), 2)

    def rows(self):
        """Blocks grouped into ordered rows: [[block, block], [block], ...].

        Each inner list is one visual row, its blocks ordered by `col`. Rows are
        ordered by the `row` value ascending. The renderer and the editor both use
        this to lay columns out within a row.
        """
        self.ensure_one()
        buckets = {}
        for block in self.block_ids.sorted(lambda b: (b.row, b.col)):
            buckets.setdefault(block.row, []).append(block)
        return [buckets[r] for r in sorted(buckets)]


class PosInvoiceLayoutBlock(models.Model):
    """One block placed at (row, col) in a layout, with its own style/content.

    (row, col, width_pct) is the grid position the editor writes: drag to a new
    row → `row`; drop beside another → same `row`, new `col`; set width in the
    Options panel → `width_pct`. Columns in a row should sum to ~100%.
    """
    _name = 'pos.invoice.layout.block'
    _description = 'POS Invoice Layout Block'
    _order = 'row, col, id'

    layout_id = fields.Many2one(
        'pos.invoice.layout', string='Layout', required=True,
        ondelete='cascade', index=True,
    )
    block_type = fields.Selection(BLOCK_TYPES, string='Block', required=True)

    # Grid position.
    row = fields.Integer(string='Row', default=0)
    col = fields.Integer(string='Column', default=0)
    width_pct = fields.Integer(string='Width %', default=100)

    # Common styling — thermal-safe: colour is always pure black at render time,
    # so no colour field here (see thermal-receipt-blobs-printer-darkness).
    visible = fields.Boolean(string='Visible', default=True)
    align = fields.Selection(
        [('left', 'Left'), ('center', 'Center'), ('right', 'Right'), ('auto', 'Auto')],
        string='Align', default='auto',
    )
    direction = fields.Selection(
        [('ltr', 'Left-to-right'), ('rtl', 'Right-to-left'), ('auto', 'Auto')],
        string='Text Direction', default='auto',
    )
    font_size_px = fields.Integer(string='Font Size (px)', default=0,
                                  help='0 = template default.')
    bold = fields.Boolean(string='Bold', default=False)
    label_en = fields.Char(string='Label (English)')
    label_ar = fields.Char(string='Label (Arabic)')
    # Free text the user types for a 'custom_text' block (e.g. an address).
    # Both render; Arabic gets rtl. Multi-line supported.
    content_en = fields.Text(string='Custom Text (English)')
    content_ar = fields.Text(string='Custom Text (Arabic)')

    # Grid placement (in CENTIMETRES, 0.5cm steps), used in 'grid' positioning.
    # The editor snaps to 0.5cm; the renderer positions in cm (7.5cm works).
    grid_x = fields.Float(string='Grid X (cm)', default=0)
    grid_y = fields.Float(string='Grid Y (cm)', default=0)
    grid_w = fields.Float(string='Grid W (cm)', default=0)
    grid_h = fields.Float(string='Grid H (cm)', default=0)

    # Per-type extras (only meaningful for some block_types).
    logo_width_pct = fields.Integer(string='Logo Width %', default=45)
    barcode_field = fields.Selection(
        [('id', 'Order ID'), ('name', 'Order Ref'), ('pos_reference', 'POS Reference')],
        string='Barcode Source', default='name',
    )
    qr_data = fields.Char(string='QR Data', help='Store URL or plain text; supports placeholders.')
    show_line_meta = fields.Boolean(string='Show Line Meta Fields', default=False)
    show_line_properties = fields.Boolean(string='Show Line Properties', default=False)
    show_line_tags = fields.Boolean(string='Show Line Tags', default=False)

    @api.constrains('width_pct')
    def _check_width_pct(self):
        for rec in self:
            if rec.width_pct < 1 or rec.width_pct > 100:
                raise ValidationError(_('Width %% must be between 1 and 100.'))

    # ---- self-contained QR (thermal-safe base64; used by the renderer) ----
    def qr_b64(self):
        """QR image (base64 PNG) built from this block's QR Data (a link/text the
        admin pastes in Options). Falls back to the company website. Empty when
        there's nothing to encode, so the renderer can hide it."""
        self.ensure_one()
        value = self.qr_data or (self.layout_id.company_id.website or '')
        if not value:
            return ''
        try:
            import base64
            img = self.env['ir.actions.report'].barcode(
                'QR', value, width=300, height=300)
            return base64.b64encode(img).decode('ascii')
        except Exception:
            return ''


class PosInvoiceHeaderField(models.Model):
    """One row of the bilingual Company Header table (C.R. No, GSM, VAT, or a custom
    field the admin adds). Company-wide, reorderable, each with an English label, an
    Arabic label and a value — all editable from the visual editor."""
    _name = 'pos.invoice.header.field'
    _description = 'POS Invoice Company-Header Field'
    _order = 'sequence, id'

    company_id = fields.Many2one(
        'res.company', string='Company', required=True, ondelete='cascade', index=True,
        default=lambda s: s.env.company,
    )
    sequence = fields.Integer(string='Sequence', default=10)
    label_en = fields.Char(string='Label (English)')
    label_ar = fields.Char(string='Label (Arabic)')
    value = fields.Char(string='Value')
    visible = fields.Boolean(string='Visible', default=True)
