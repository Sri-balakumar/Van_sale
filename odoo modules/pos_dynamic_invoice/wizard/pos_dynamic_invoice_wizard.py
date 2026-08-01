import logging

from odoo import _, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


def compute_size_css(width, height=0):
    """Width-derived CSS values, same logic as invoiceHtml.js:73-85 and the
    pos_receipt_preview module.

    Returns the receipt body width, the @page size token and the signature
    image max-height for the given paper width (mm). Shared by the wizard and
    the app render path so both produce identical output.

    `height` (mm) is 0 for the presets (auto/continuous height); a positive
    value pins a fixed page height — used by the Custom size.
    """
    width = int(width or 80)
    height = int(height or 0)
    receipt_width = max(10, width - 8)  # 4mm margin x 2, like the app
    # Presets use a fixed width + auto height so the receipt renders as ONE
    # continuously-growing page. Named sheets (A4/A5) have a fixed physical
    # height, which split a tall receipt across 2 pages on Download/Print — the
    # `<width>mm auto` form avoids that. A Custom size may pin an explicit
    # height (`<width>mm <height>mm`).
    page_size_css = ('%dmm %dmm' % (width, height)) if height > 0 else ('%dmm auto' % width)
    if width >= 148:
        sig_max_h = 70
    elif width <= 58:
        sig_max_h = 38
    else:
        sig_max_h = 50
    return {
        'width': width,
        'receipt_width': receipt_width,
        'page_size_css': page_size_css,
        'sig_max_h': sig_max_h,
    }


class PosDynamicInvoiceWizard(models.TransientModel):
    """The 'choose receipt size' popup for the dynamic invoice.

    Holds the target order and the selected paper width, then renders the
    dynamic receipt through the standard Odoo report (qweb-html) so the preview
    embeds in Odoo and the report toolbar's Print/Download work the normal way.
    The same wizard is created transiently by
    pos.order.get_dynamic_receipt_html() to render for the mobile app.
    """
    _name = 'pos.dynamic.invoice.wizard'
    _description = 'POS Dynamic Invoice (paper size picker)'

    # Exactly one of these is set. `order_id` is not `required` any more so an
    # account.move can drive the same wizard; the backend view still always
    # supplies it, and _render_source() raises if neither is filled.
    order_id = fields.Many2one('pos.order', string='Order', ondelete='cascade')
    move_id = fields.Many2one('account.move', string='Invoice', ondelete='cascade')

    # The exact six sizes from the app's PaperSizeModal (mm), 80mm default, plus
    # a 'custom' option driven by custom_width/custom_height.
    paper_size = fields.Selection([
        ('50', '2 inch (50 mm)'),
        ('76', '3 inch (76 mm)'),
        ('80', '3.5 inch (80 mm)'),
        ('100', '4 inch (100 mm)'),
        ('148', 'A5 (148 mm)'),
        ('210', 'A4 (210 mm)'),
        ('custom', 'Custom (W × H mm)'),
    ], string='Receipt Size', default='80', required=True)
    # Used only when paper_size == 'custom'. Height 0 = auto (continuous roll).
    custom_width = fields.Integer(string='Custom Width (mm)', default=80)
    custom_height = fields.Integer(string='Custom Height (mm)', default=0)

    def _render_source(self):
        """The record this wizard renders — a pos.order or an account.move.

        Both implement pos.dynamic.receipt.mixin, so everything below treats
        them identically.
        """
        self.ensure_one()
        source = self.order_id or self.move_id
        if not source:
            raise UserError(_('Nothing to render: set either an Order or an Invoice.'))
        return source

    def _render_context(self):
        """Width-derived CSS + the source record's receipt payload. Called from
        the QWeb template per wizard record."""
        self.ensure_one()
        if self.paper_size == 'custom':
            # Custom is one continuous page (auto height) — never split.
            width, height = (self.custom_width or 80), 0
        else:
            width, height = int(self.paper_size or 80), 0
        source = self._render_source()
        context = compute_size_css(width, height)
        context['d'] = source.get_dynamic_receipt_data()
        # Layout-driven receipt: resolve (and lazily seed) the layout for this
        # company + paper size, so the third dispatcher branch can render it.
        # Only when the settings template is 'layout' — otherwise skip the lookup.
        context['layout'] = False
        if context['d'].get('invoice_template') == 'layout':
            company = source.company_id or self.env.company
            context['layout'] = self._resolve_layout(company, width)
        return context

    def _resolve_layout(self, company, width):
        """The layout to render at `width` mm, degrading gracefully.

        The dispatcher renders the Custom Layout branch only while `layout` is
        truthy — otherwise it silently falls through to the Standard template.
        An exact width match is therefore not good enough on its own: the size
        picker lets a user type any custom width, and a width with no
        pos.invoice.paper.size record would print a completely different
        template with no error. So fall back to the nearest configured size,
        then to the company default, and log whenever we do.
        """
        Size = self.env['pos.invoice.paper.size'].sudo()
        Layout = self.env['pos.invoice.layout']
        base = [('company_id', '=', company.id)]

        size = Size.search(base + [('width_mm', '=', width)], limit=1)
        if size:
            return Layout.resolve_for(company, size)

        # Nearest configured width — keeps the proportions as close as possible
        # to what the user asked for. Excludes the per-company 'Custom' record,
        # whose width_mm is a placeholder rather than a real paper size.
        candidates = Size.search(base + [('is_custom', '=', False)])
        if candidates:
            nearest = min(candidates, key=lambda s: abs((s.width_mm or 0) - width))
            _logger.info(
                '[LAYOUT] no %smm size for company %s — falling back to nearest: %s (%smm)',
                width, company.id, nearest.name, nearest.width_mm,
            )
            return Layout.resolve_for(company, nearest)

        settings = self.env['pos.invoice.settings'].get_for_company(company)
        default_size = settings.default_paper_size_id
        if default_size:
            _logger.info(
                '[LAYOUT] no sizes configured for company %s — falling back to default: %s',
                company.id, default_size.name,
            )
            return Layout.resolve_for(company, default_size)

        _logger.warning(
            '[LAYOUT] company %s has no paper sizes at all — Custom Layout cannot render, '
            'the Standard template will print instead.', company.id,
        )
        return False

    def action_preview(self):
        """Render the dynamic receipt via the standard Odoo report."""
        self.ensure_one()
        return self.env.ref('pos_dynamic_invoice.action_report_pos_dynamic_invoice').report_action(self)
