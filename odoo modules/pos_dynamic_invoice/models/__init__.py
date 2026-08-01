from . import pos_invoice_paper_size
from . import pos_invoice_layout
from . import pos_invoice_settings
# The mixin must load before the models that inherit it.
from . import dynamic_receipt_mixin
from . import pos_order
from . import account_move
