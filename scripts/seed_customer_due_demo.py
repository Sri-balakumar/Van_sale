#!/usr/bin/env python3
"""Seed demo grocery-shop customers who owe money, for testing Customer Due.

Both places the due is shown are hidden when the balance is zero, so on a clean
database there is nothing to look at. This creates several customers each
carrying an outstanding balance, built from posted, unpaid customer invoices:

    Al Noor Grocery              45.500 + 32.000  ->   77.500
    Salim Mini Mart                     128.750   ->  128.750
    Green Valley Supermarket     15.250 + 60.000  ->   75.250
    Hilal Foodstuff Trading             210.000   ->  210.000
    Muscat Corner Store                   8.500   ->    8.500

Two customers carry more than one invoice, so the printed figure has to be a
real sum rather than a single line read back. Muscat Corner Store's small
balance is there to check the block still reads sensibly at low values.

Dues come from UNPAID invoices rather than partly-paid ones on purpose: Odoo 19
posts an account.payment to `in_process` with no journal entry, so there is
nothing to reconcile against over RPC. An unpaid invoice gives the same
outstanding balance with none of that fragility, and matches the shape of a
real credit sale anyway.

Safe to re-run: records are looked up by name/ref and reused instead of piling
up duplicates. Nothing is added to the Odoo modules themselves, so no client
install ever receives this data.

NOTE — seeding alone does NOT make the app's Orders History card appear. That
card reads a snapshot written by pos.order.capture_customer_due(), which only
runs when the APP completes a sale. What is seeded here is the customer's
PREVIOUS due; to see the card, seed first, then make a sale in the app to one
of these customers and open that order in Orders History.

Usage
-----
    py scripts/seed_customer_due_demo.py \
        --url http://localhost:8069 --db grocery_shop --user admin --password admin

    # remove everything it created
    py scripts/seed_customer_due_demo.py ... --cleanup

Only needs the Python standard library.
"""
import argparse
import json
import sys
import urllib.request

# Each entry: the customer, and the invoice amounts that make up their debt.
# `slug` namespaces the invoice refs so one customer's cleanup can never touch
# another's — or, worse, a real invoice that happens to share a ref.
DEMO_CUSTOMERS = [
    {'name': 'Demo - Al Noor Grocery', 'slug': 'ALNOOR',
     'city': 'Muscat', 'street': 'Al Khuwair Street 12',
     'invoices': [45.500, 32.000]},
    {'name': 'Demo - Salim Mini Mart', 'slug': 'SALIM',
     'city': 'Seeb', 'street': 'Mabela South 4',
     'invoices': [128.750]},
    {'name': 'Demo - Green Valley Supermarket', 'slug': 'GREENVALLEY',
     'city': 'Muscat', 'street': 'Ruwi High Street 88',
     'invoices': [15.250, 60.000]},
    {'name': 'Demo - Hilal Foodstuff Trading', 'slug': 'HILAL',
     'city': 'Sohar', 'street': 'Falaj Al Qabail 7',
     'invoices': [210.000]},
    {'name': 'Demo - Muscat Corner Store', 'slug': 'CORNER',
     'city': 'Muscat', 'street': 'Wadi Kabir 3',
     'invoices': [8.500]},
]

# The POS demo order needs an open session and a Customer Account payment
# method, so it is attached to ONE customer rather than all five — it degrades
# gracefully to a skip when the database can't support it.
POS_CUSTOMER_SLUG = 'ALNOOR'

# POS-side demo: one credit sale, tagged via `pos_reference` so the script can
# find (and clean up) its own record without relying on the generated name.
#
# The tag carries the customer's slug. The earlier version used a bare
# 'DEMO-DUE-POS', and `create_pos_order` treats any order with that reference as
# "already seeded" WITHOUT checking whose it is — so an order left over from a
# run against a different demo customer was silently reused, and the summary
# then quoted that customer's balance instead of this one's.
POS_ORDER_TAG = 'DEMO-DUE-POS-%s' % POS_CUSTOMER_SLUG
POS_INVOICE_REF = 'DEMO-DUE-POS-%s' % POS_CUSTOMER_SLUG
POS_TOTAL = 25.0

# Tags and customers written by earlier versions of this script. Kept only so
# `--cleanup` can still sweep them up; nothing new is ever created under these.
LEGACY_POS_TAG = 'DEMO-DUE-POS'
LEGACY_INVOICE_REFS = ['DEMO-DUE-1', 'DEMO-DUE-2', 'DEMO-DUE-POS']
LEGACY_CUSTOMERS = ['Demo - Ahmed Trading']


def invoice_refs(cust):
    """The invoice refs belonging to one demo customer.

    Namespaced by slug so `--cleanup` can only ever match records this script
    created. The original single-customer version keyed on a bare 'DEMO-DUE-n'
    and searched on `ref` alone, which on a real shop database could collide
    with — and then delete — a genuine invoice.
    """
    return ['DEMO-DUE-%s-%d' % (cust['slug'], i + 1)
            for i in range(len(cust['invoices']))]


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


def find_or_create_customer(odoo, cust):
    """Look up one demo customer by name, creating it if absent.

    Searches with `active_test: False` because `cleanup()` ARCHIVES a partner it
    cannot delete (one still referenced by a posted invoice). Without this the
    default active-only search misses the archived record and a re-run silently
    creates a duplicate customer every time.
    """
    found = odoo.kw('res.partner', 'search_read',
                    [[['name', '=', cust['name']]]],
                    {'fields': ['id', 'active'], 'limit': 1,
                     'context': {'active_test': False}})
    if found:
        if not found[0].get('active'):
            odoo.kw('res.partner', 'write', [[found[0]['id']], {'active': True}])
            print('  %s was archived -> restored (id %s)' % (cust['name'], found[0]['id']))
        else:
            print('  %s exists -> id %s' % (cust['name'], found[0]['id']))
        return found[0]['id']
    partner_id = odoo.kw('res.partner', 'create', [{
        'name': cust['name'],
        'customer_rank': 1,
        'street': cust['street'],
        'city': cust['city'],
    }])
    print('  %s created -> id %s' % (cust['name'], partner_id))
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
    # Scoped by move_type AND company, not `ref` alone: a bare ref match can
    # hit a vendor bill or a record in another company and treat it as "already
    # seeded" — and `cleanup()` would then delete it.
    existing = odoo.kw('account.move', 'search_read',
                       [[['ref', '=', ref],
                         ['move_type', '=', 'out_invoice'],
                         ['company_id', '=', company_id]]],
                       {'fields': ['id', 'amount_residual'], 'limit': 1})
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
                     [[['pos_reference', 'in', [POS_ORDER_TAG, LEGACY_POS_TAG]]]],
                     {'fields': ['id', 'name']})
    if orders:
        ids = [o['id'] for o in orders]
        payments = odoo.kw('pos.payment', 'search_read',
                           [[['pos_order_id', 'in', ids]]], {'fields': ['id']})
        if payments:
            odoo.kw('pos.payment', 'unlink', [[p['id'] for p in payments]])
        # Detach the invoice BEFORE trying to delete anything, so the move can
        # be unlinked further down. Odoo 19 permits writing `account_move` on a
        # paid order even though it refuses any state change — the guard is on
        # the state field, not the record as a whole.
        odoo.kw('pos.order', 'write', [ids, {'account_move': False}])
        try:
            odoo.kw('pos.order', 'unlink', [ids])
            print('  removed %d demo POS order(s)' % len(ids))
        except SystemExit:
            # Odoo 19 refuses BOTH state=draft/cancel ("This order has already
            # been paid") and deletion ("In order to delete a sale, it must be
            # new or cancelled") once an order is paid. Nothing over RPC gets
            # past that, so report it instead of aborting the whole cleanup —
            # the order is inert now its payments and invoice link are gone.
            print('  %d paid demo POS order(s) cannot be deleted on Odoo 19:' % len(ids))
            print('    %s' % ', '.join(o['name'] for o in orders))
            print('    payments and invoice link removed; delete from the POS backend if needed.')

    refs = [POS_INVOICE_REF] + LEGACY_INVOICE_REFS
    for cust in DEMO_CUSTOMERS:
        refs.extend(invoice_refs(cust))
    # Constrained to customer invoices this script could have created. `ref`
    # alone would also match a vendor bill or another company's move, and the
    # button_draft + unlink below would then destroy it.
    moves = odoo.kw('account.move', 'search_read',
                    [[['ref', 'in', refs], ['move_type', '=', 'out_invoice']]],
                    {'fields': ['id', 'ref']})
    if moves:
        ids = [m['id'] for m in moves]
        # Payments must be unreconciled + a posted move reset to draft first.
        odoo.kw('account.move', 'button_draft', [ids])
        odoo.kw('account.move', 'unlink', [ids])
        print('  removed %d demo invoice(s)' % len(ids))

    for name in [c['name'] for c in DEMO_CUSTOMERS] + LEGACY_CUSTOMERS:
        partners = odoo.kw('res.partner', 'search_read',
                           [[['name', '=', name]]],
                           {'fields': ['id'], 'limit': 1,
                            'context': {'active_test': False}})
        if not partners:
            continue
        try:
            odoo.kw('res.partner', 'unlink', [[partners[0]['id']]])
            print('  removed %s' % name)
        except SystemExit:
            # Odoo refuses to delete a partner still referenced by anything —
            # archive instead so it stops appearing in the customer list.
            odoo.kw('res.partner', 'write', [[partners[0]['id']], {'active': False}])
            print('  %s still referenced — archived instead' % name)


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
    # Resolved once, not per customer: every demo invoice must land in the SAME
    # company, because the due is scoped by company — a customer with invoices
    # spread across two companies reads as owing less than they do.
    company_id = resolve_company(odoo)
    journal = sale_journal_id(odoo, company_id)

    seeded = []
    pos_order_id = None
    for cust in DEMO_CUSTOMERS:
        print('')
        print('%s:' % cust['name'])
        partner_id = find_or_create_customer(odoo, cust)
        for ref, amount in zip(invoice_refs(cust), cust['invoices']):
            create_invoice(odoo, partner_id, journal, ref, amount, company_id)
        if cust['slug'] == POS_CUSTOMER_SLUG:
            pos_order_id = create_pos_order(odoo, partner_id, journal, company_id)
        seeded.append((cust, partner_id))

    print('')
    print('Outstanding balances (same domain as Partner Ledger and the receipt):')
    totals = {}
    for cust, partner_id in seeded:
        lines = odoo.kw('account.move.line', 'search_read', [[
            ['partner_id', '=', partner_id],
            ['account_id.account_type', '=', 'asset_receivable'],
            ['parent_state', '=', 'posted'],
            ['reconciled', '=', False],
        ]], {'fields': ['amount_residual']})
        outstanding = sum(l['amount_residual'] for l in lines)
        totals[cust['slug']] = outstanding
        print('  %-34s %10.3f' % (cust['name'], outstanding))

    pos_cust = next(c for c in DEMO_CUSTOMERS if c['slug'] == POS_CUSTOMER_SLUG)
    pos_total_due = totals[pos_cust['slug']]
    # The POS demo order's own invoice is excluded from its "previous" due, so
    # quote that figure separately — it is what its receipt will actually show.
    prev_for_pos_order = pos_total_due - POS_TOTAL if pos_order_id else pos_total_due

    print('')
    print('To test:')
    print('  1. Accounting -> Invoices -> open a DEMO-DUE invoice -> Print.')
    print('     Fastest check: needs no POS session, no app.')
    if pos_order_id:
        print('  2. My Orders -> open the %s order -> print. Expect:' % POS_ORDER_TAG)
        print('       Previous Due  %.3f' % prev_for_pos_order)
        print('       This Invoice  %.3f' % POS_TOTAL)
        print('       TOTAL DUE     %.3f' % pos_total_due)
    else:
        print('  2. (POS order skipped — see the note above.)')
    print('  3. Start a new POS sale for "%s" — the amber' % pos_cust['name'])
    print('     "Previous Due" card should read %.3f on the payment screen.' % pos_total_due)
    print('  4. IN THE APP, complete that sale on credit, then open it in')
    print('     My Orders. The Customer Due card there is a FROZEN snapshot')
    print('     written at sale time — seeded data alone cannot produce it,')
    print('     only a sale made through the app can.')
    print('  5. Cross-check against Accounting -> Partner Ledger ("With residual").')
    print('  6. Re-run with --cleanup to remove all of it.')


if __name__ == '__main__':
    sys.exit(main())
