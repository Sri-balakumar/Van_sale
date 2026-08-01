#!/usr/bin/env python3
"""Seed demo data for testing the Customer Due block and the invoice Print button.

Creates one demo customer and three posted customer invoices with different
payment states, so the receipt's "Previous Due / This Invoice / Total Due"
block and the POS Payment "Previous Due" card have something real to show:

    Demo - Ahmed Trading
      unpaid invoice      120.000   -> residual 120.000
      half-paid invoice    80.000   -> residual  40.000
      fully-paid invoice   55.000   -> residual   0.000
                                       Previous Due = 160.000

Safe to re-run: it looks records up by name and reuses them instead of piling
up duplicates. Nothing is added to the Odoo modules themselves, so no client
install ever receives this data.

Usage
-----
    py scripts/seed_customer_due_demo.py \
        --url http://localhost:8069 --db mydb --user admin --password admin

    # remove everything it created
    py scripts/seed_customer_due_demo.py ... --cleanup

Only needs the Python standard library.
"""
import argparse
import json
import sys
import urllib.request

DEMO_CUSTOMER = 'Demo - Ahmed Trading'
# (reference, amount). All left unpaid: Odoo 19 posts an account.payment to
# `in_process` with no journal entry, so there is nothing to reconcile against
# over RPC. Unpaid invoices give the same outstanding balance with none of that
# fragility — and match the real shape of a credit sale anyway.
DEMO_INVOICES = [
    ('DEMO-DUE-1', 120.0),
    ('DEMO-DUE-2', 40.0),
]

# POS-side demo: one part-credit sale. `note` tags the order so the script can
# find (and clean up) its own record without relying on the generated name.
POS_ORDER_TAG = 'DEMO-DUE-POS'
POS_INVOICE_REF = 'DEMO-DUE-POS'
POS_TOTAL = 25.0


class Odoo:
    """Minimal Odoo JSON-RPC client (the same /web/dataset/call_kw the app uses)."""

    def __init__(self, url, db, user, password):
        self.url = url.rstrip('/')
        self.db = db
        self.uid = self._call('/web/session/authenticate', {
            'db': db, 'login': user, 'password': password,
        }).get('uid')
        if not self.uid:
            raise SystemExit('Authentication failed — check --db, --user and --password.')

    def _call(self, path, params):
        payload = json.dumps({'jsonrpc': '2.0', 'method': 'call', 'params': params}).encode()
        req = urllib.request.Request(
            self.url + path, data=payload,
            headers={'Content-Type': 'application/json'},
        )
        if getattr(self, '_cookie', None):
            req.add_header('Cookie', self._cookie)
        with urllib.request.urlopen(req) as resp:
            set_cookie = resp.headers.get('Set-Cookie')
            if set_cookie:
                self._cookie = set_cookie.split(';')[0]
            body = json.loads(resp.read().decode())
        if 'error' in body:
            message = body['error'].get('data', {}).get('message') or body['error'].get('message')
            raise SystemExit('Odoo error: %s' % message)
        return body.get('result')

    def kw(self, model, method, args, kwargs=None):
        return self._call('/web/dataset/call_kw', {
            'model': model, 'method': method,
            'args': args, 'kwargs': kwargs or {},
        })


def find_or_create_customer(odoo):
    found = odoo.kw('res.partner', 'search_read',
                    [[['name', '=', DEMO_CUSTOMER]]], {'fields': ['id'], 'limit': 1})
    if found:
        print('  customer exists -> id %s' % found[0]['id'])
        return found[0]['id']
    partner_id = odoo.kw('res.partner', 'create', [{
        'name': DEMO_CUSTOMER,
        'customer_rank': 1,
        'street': 'Demo Street 1',
        'city': 'Muscat',
    }])
    print('  customer created -> id %s' % partner_id)
    return partner_id


def resolve_company(odoo):
    """The company the demo data must live in.

    Prefer the company of the open POS session, because the receipt scopes the
    customer's due to the ORDER's company — invoices created in a different
    company are correctly ignored and the due would read 0. Falls back to the
    logged-in user's company when no session is open.
    """
    sessions = odoo.kw('pos.session', 'search_read',
                       [[['state', '=', 'opened']]], {'fields': ['config_id'], 'limit': 1})
    if sessions:
        cfg = odoo.kw('pos.config', 'read',
                      [[sessions[0]['config_id'][0]], ['company_id']])[0]
        if cfg.get('company_id'):
            print('  company from open POS session -> %s (%s)'
                  % (cfg['company_id'][1], cfg['company_id'][0]))
            return cfg['company_id'][0]
    user = odoo.kw('res.users', 'read', [[odoo.uid], ['company_id']])[0]
    print('  company from user -> %s (%s)' % (user['company_id'][1], user['company_id'][0]))
    return user['company_id'][0]


def sale_journal_id(odoo, company_id):
    found = odoo.kw('account.journal', 'search_read',
                    [[['type', '=', 'sale'], ['company_id', '=', company_id]]],
                    {'fields': ['id'], 'limit': 1})
    if not found:
        raise SystemExit('No sale journal in company %s — is Accounting configured there?'
                         % company_id)
    return found[0]['id']


def bank_journal_id(odoo):
    found = odoo.kw('account.journal', 'search_read',
                    [[['type', 'in', ['bank', 'cash']]]], {'fields': ['id'], 'limit': 1})
    if not found:
        raise SystemExit('No bank/cash journal found — cannot register demo payments.')
    return found[0]['id']


def create_invoice(odoo, partner_id, journal, ref, amount, company_id):
    existing = odoo.kw('account.move', 'search_read',
                       [[['ref', '=', ref]]], {'fields': ['id', 'amount_residual'], 'limit': 1})
    if existing:
        print('  %s exists -> id %s (residual %s)'
              % (ref, existing[0]['id'], existing[0]['amount_residual']))
        return existing[0]['id']

    move_id = odoo.kw('account.move', 'create', [{
        'move_type': 'out_invoice',
        'partner_id': partner_id,
        'journal_id': journal,
        # Must match the POS order's company — the receipt scopes the due by
        # company, so an invoice elsewhere is silently ignored.
        'company_id': company_id,
        'ref': ref,
        'invoice_line_ids': [(0, 0, {
            'name': 'Demo product for %s' % ref,
            'quantity': 1,
            'price_unit': amount,
            # No tax, so the residual maths in the output below stays obvious.
            'tax_ids': [(6, 0, [])],
        })],
    }])
    odoo.kw('account.move', 'action_post', [[move_id]])
    residual = odoo.kw('account.move', 'read', [[move_id], ['amount_residual']])[0]['amount_residual']
    print('  %s created -> id %s (residual %s)' % (ref, move_id, residual))
    return move_id


def create_pos_order(odoo, partner_id, journal, company_id):
    """A part-credit POS order, so its receipt exercises all three due lines.

    Written directly rather than through sync_from_ui, so it creates no
    stock.picking and moves no inventory — enough to render a receipt, not a
    stock test. Mirrors what the app produces for a credit sale: POS payments
    covering the full total (Cash + Customer Account) PLUS a linked invoice
    that is only partly paid. That linked invoice is what actually carries the
    debt — pos.order.amount_paid counts the Customer Account tender as paid.
    """
    existing = odoo.kw('pos.order', 'search_read',
                       [[['pos_reference', '=', POS_ORDER_TAG]]], {'fields': ['id', 'name'], 'limit': 1})
    if existing:
        print('  POS order exists -> id %s (%s)' % (existing[0]['id'], existing[0]['name']))
        return existing[0]['id']

    sessions = odoo.kw('pos.session', 'search_read',
                       [[['state', '=', 'opened']]], {'fields': ['id', 'config_id'], 'limit': 1})
    if not sessions:
        print('  SKIPPED: no open POS session. Open a register in the app (or Odoo) and re-run '
              'to get the POS-side demo order.')
        return None
    session = sessions[0]

    products = odoo.kw('product.product', 'search_read',
                       [[['available_in_pos', '=', True]]], {'fields': ['id', 'name'], 'limit': 1})
    if not products:
        products = odoo.kw('product.product', 'search_read', [[]], {'fields': ['id', 'name'], 'limit': 1})
    if not products:
        print('  SKIPPED: no product to sell.')
        return None
    product = products[0]

    # Cash method has a journal; the customer-account (credit) method is the
    # split_transactions one and has none.
    methods = odoo.kw('pos.payment.method', 'search_read', [[]],
                      {'fields': ['id', 'name', 'journal_id', 'split_transactions']})
    credit = next((m for m in methods if m['split_transactions']), None)
    if not credit:
        print('  SKIPPED: no customer-account (credit) payment method configured.')
        return None

    # The linked invoice carries the debt — left fully unpaid, so this is a
    # pure credit sale, the same shape as the real orders in the database.
    move_id = create_invoice(odoo, partner_id, journal, POS_INVOICE_REF, POS_TOTAL, company_id)

    order_id = odoo.kw('pos.order', 'create', [{
        'session_id': session['id'],
        'partner_id': partner_id,
        'pos_reference': POS_ORDER_TAG,
        'amount_tax': 0.0,
        'amount_total': POS_TOTAL,
        'amount_paid': POS_TOTAL,
        'amount_return': 0.0,
        'lines': [(0, 0, {
            'product_id': product['id'],
            'qty': 1,
            'price_unit': POS_TOTAL,
            'price_subtotal': POS_TOTAL,
            'price_subtotal_incl': POS_TOTAL,
        })],
    }])
    # Payments must go on while the order is still draft — Odoo refuses to edit
    # a payment once the order is posted, which is why account_move is linked
    # only afterwards.
    odoo.kw('pos.payment', 'create', [{
        'pos_order_id': order_id,
        'payment_method_id': credit['id'],
        'amount': POS_TOTAL,
    }])
    odoo.kw('pos.order', 'write', [[order_id], {'state': 'paid', 'account_move': move_id}])

    name = odoo.kw('pos.order', 'read', [[order_id], ['name']])[0]['name']
    print('  POS order created -> id %s (%s): %s fully on customer account'
          % (order_id, name, POS_TOTAL))
    return order_id


def cleanup(odoo):
    # POS order first — it references the invoice, so the move cannot be
    # unlinked while the order still points at it.
    orders = odoo.kw('pos.order', 'search_read',
                     [[['pos_reference', '=', POS_ORDER_TAG]]], {'fields': ['id']})
    if orders:
        ids = [o['id'] for o in orders]
        odoo.kw('pos.payment', 'unlink',
                [[p['id'] for p in odoo.kw('pos.payment', 'search_read',
                                           [[['pos_order_id', 'in', ids]]], {'fields': ['id']})]])
        odoo.kw('pos.order', 'write', [ids, {'state': 'draft', 'account_move': False}])
        odoo.kw('pos.order', 'unlink', [ids])
        print('  removed %d demo POS order(s)' % len(ids))

    refs = [ref for ref, _amount in DEMO_INVOICES] + [POS_INVOICE_REF]
    moves = odoo.kw('account.move', 'search_read',
                    [[['ref', 'in', refs]]], {'fields': ['id', 'ref']})
    if moves:
        ids = [m['id'] for m in moves]
        # Payments must be unreconciled + a posted move reset to draft first.
        odoo.kw('account.move', 'button_draft', [ids])
        odoo.kw('account.move', 'unlink', [ids])
        print('  removed %d demo invoice(s)' % len(ids))
    partners = odoo.kw('res.partner', 'search_read',
                       [[['name', '=', DEMO_CUSTOMER]]], {'fields': ['id'], 'limit': 1})
    if partners:
        try:
            odoo.kw('res.partner', 'unlink', [[partners[0]['id']]])
            print('  removed demo customer')
        except SystemExit:
            # Odoo refuses to delete a partner still referenced by anything —
            # archive instead so it stops appearing in the customer list.
            odoo.kw('res.partner', 'write', [[partners[0]['id']], {'active': False}])
            print('  demo customer still referenced — archived instead')


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--url', required=True, help='Odoo base URL, e.g. http://localhost:8069')
    parser.add_argument('--db', required=True, help='Database name')
    parser.add_argument('--user', required=True, help='Login')
    parser.add_argument('--password', required=True, help='Password or API key')
    parser.add_argument('--cleanup', action='store_true', help='Delete the demo data instead')
    args = parser.parse_args()

    odoo = Odoo(args.url, args.db, args.user, args.password)
    print('Connected to %s (db=%s) as uid %s' % (args.url, args.db, odoo.uid))

    if args.cleanup:
        print('Removing demo data...')
        cleanup(odoo)
        print('Done.')
        return

    print('Seeding Customer Due demo data...')
    partner_id = find_or_create_customer(odoo)
    company_id = resolve_company(odoo)
    journal = sale_journal_id(odoo, company_id)
    for ref, amount in DEMO_INVOICES:
        create_invoice(odoo, partner_id, journal, ref, amount, company_id)

    pos_order_id = create_pos_order(odoo, partner_id, journal, company_id)

    lines = odoo.kw('account.move.line', 'search_read', [[
        ['partner_id', '=', partner_id],
        ['account_id.account_type', '=', 'asset_receivable'],
        ['parent_state', '=', 'posted'],
        ['reconciled', '=', False],
    ]], {'fields': ['amount_residual']})
    outstanding = sum(l['amount_residual'] for l in lines)

    # The POS demo order's own invoice is excluded from its "previous" due, so
    # quote that figure separately — it is what its receipt will actually show.
    prev_for_pos_order = outstanding - POS_TOTAL if pos_order_id else outstanding

    print('')
    print('Done. "%s" now owes %.3f in total.' % (DEMO_CUSTOMER, outstanding))
    print('')
    print('To test:')
    print('  1. Accounting -> Invoices -> open a DEMO-DUE invoice -> Print PDF.')
    print('     Fastest check: needs no POS session.')
    if pos_order_id:
        print('  2. My Orders -> open the %s order -> print. Expect:' % POS_ORDER_TAG)
        print('       Previous Due  %.3f' % prev_for_pos_order)
        print('       This Invoice  %.3f' % POS_TOTAL)
        print('       TOTAL DUE     %.3f' % outstanding)
    else:
        print('  2. (POS order skipped — see the note above.)')
    print('  3. Start a new POS sale for "%s" — the amber "Previous Due"' % DEMO_CUSTOMER)
    print('     card should read %.3f on the payment screen.' % outstanding)
    print('  4. Cross-check against Accounting -> Partner Ledger for this customer.')
    print('  5. Re-run with --cleanup to remove all of it.')


if __name__ == '__main__':
    sys.exit(main())
