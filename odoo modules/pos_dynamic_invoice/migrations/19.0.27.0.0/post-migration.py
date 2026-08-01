from odoo import api, SUPERUSER_ID


def migrate(cr, version):
    """Add the Customer Due block to layouts that predate it.

    `_seed_default_blocks()` only runs for a layout with no blocks, so every
    layout arranged before this block existed would otherwise never show the
    customer's outstanding balance. Insert it right after Payments — where a
    fresh layout seeds it — and renumber rows so Signatures and Footer shift
    down without disturbing anything else the user arranged.

    Idempotent: a layout that already has the block is skipped, so re-running
    the upgrade never duplicates it.
    """
    env = api.Environment(cr, SUPERUSER_ID, {})
    Layout = env['pos.invoice.layout'].sudo()
    Block = env['pos.invoice.layout.block'].sudo()

    for layout in Layout.search([]):
        blocks = layout.block_ids.sorted(lambda b: (b.row, b.col, b.id))
        if 'customer_due' in blocks.mapped('block_type'):
            continue  # already migrated

        due = Block.create({
            'layout_id': layout.id, 'block_type': 'customer_due',
            'col': 0, 'width_pct': 100, 'visible': True,
        })

        ordered = list(blocks)
        # Straight after Payments; if this layout has none, append at the end
        # rather than guessing a position in the middle.
        idx = next((k for k, b in enumerate(ordered) if b.block_type == 'payments'), None)
        if idx is None:
            ordered.append(due)
        else:
            ordered.insert(idx + 1, due)

        for k, b in enumerate(ordered):
            b.row = k
