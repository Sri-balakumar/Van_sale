<!--
Content only. Every formatting decision lives in build_manual.py.

Dialect:
  %% BOOK: <subtitle> | <tagline>     starts a book, with its own cover
  # PART n  TITLE                     reversed-out part banner
  ## Title                            section heading
  ### Step n  Title                   step heading with a numbered badge
  plain line                          body paragraph, **bold** allowed
  - line                              bullet
  > LABEL  text                       callout box
  | a | b |                           table, first row is the header
  | IMAGE n | caption                 figure plate
  === sentence                        closing banner
  @@ END                              closing line

Leave a blank line between a table and anything else that starts with a pipe.
-->

%% BOOK: Everyday Guide | Open your register, sell, take the money, and hand over the receipt.

## About This Guide

This is the guide for the person who uses **Van Sale** all day: opening a register in the morning, selling to customers, taking payment, printing receipts, handling returns, and keeping products and customers tidy.

It describes the app exactly as it behaves on the tablet. Every button name, field label and message in this guide is quoted from the app itself, so what you read here is what you will see on the screen.

If you are the person who sets the system up — connecting a new tablet, deciding who can see what, designing the receipt — that is a separate job with a separate guide. It is the second half of this document.

> TIP  Your Home screen may not show every tile in this guide. An administrator can hide tiles for your login, and a hidden tile does not grey out — it disappears completely, along with its section heading if nothing is left in it. Nothing is broken; ask your administrator.

## Van Sale at a Glance

- **Start of day** — sign in, open your register, and enter the cash that is already in the drawer.
- **All day** — build an order, attach the customer, take the payment, hand over the receipt.
- **When something comes back** — open the original order and use **Return Products**.
- **As stock moves** — record what you buy in **Easy Purchase**, and send faulty goods back with **Quick Return**.
- **End of day** — close the register, and check **Orders** and **Sales Report** against your drawer.

# PART 1   GETTING INTO THE APP

### Step 1  Sign In

The app opens on the sign-in screen showing **Welcome back** and **Login to continue to your store**. Under the heading **ACCOUNT** there are just two boxes.

Type your Odoo user name into **Username or Email** and your password into **Password**, then tap **Login**.

There is no server address or database to choose here — the tablet was pointed at your server when it was first set up, and it stays there. If you leave a box empty the app tells you **Please input user name** or **Please input password**; if the details are wrong it says **Invalid credentials**.

**Auto Fill Credentials** remembers the user name and password for this server so they appear ready-typed next time. The first time you switch it on before ever logging in you will see **No saved credentials yet — log in once to save**.

| What you tap | What happens |
| **Username or Email** | Your Odoo login — the same one you would use in the back office |
| **Password** | Your Odoo password |
| **Auto Fill Credentials** | Fills both boxes for you on this server from now on |
| **Login** | Signs you in and opens the Home screen |

| IMAGE 1 | The sign-in screen — Welcome back, the ACCOUNT card and the Auto Fill Credentials switch

### Step 2  Find Your Way Around Home

Home is the map of the whole app. At the top are your company logo, a banner strip, and today's date and time. Below that is a bar reading **Quick Access** and **Manage your store**, with your company name beside it.

Everything else is grouped into sections, each with a count of the tiles inside it.

| Section | What lives in it |
| **Sales & POS** | **POS**, **Orders**, **Sales Report** |
| **Inventory** | **Products**, **Stock** |
| **Easy Purchase** | **Easy Purchase**, **Quick Return** |
| **Contacts** | **Customers**, **Customer ID Proofs** |
| **Finance** | **Expenses** |
| **Accounting** | **Invoices**, **Journal Entries**, **Partner Ledger** |
| **Administration** | **Users**, **App Banners**, **Apps Privileges**, **Invoice Settings**, **User Manual** |

The five **Administration** tiles are for administrators only. They stay visible to everyone, but tapping one as an ordinary user just shows **Only administrators can access this feature**.

**Journal Entries** behaves differently from every other tile: instead of opening a list it opens a small **Select Journal** window offering **Sales**, **Purchases**, **Bank & Cash** and **Miscellaneous**.

> TIP  Pressing the tablet's back button on Home shows **Press back again to exit**. Press it a second time within two seconds and the app closes.

| IMAGE 2 | The Home screen — the Quick Access bar and the grouped tiles

### Step 3  The Three Tabs, and Signing Out

Along the bottom of every screen sit three tabs: **Home**, **Profile** and **Logout**.

**Profile** shows who you are signed in as — a **Connected** badge, then **User ID**, **Database**, **Role** and **Login**. Under **HELP** there is **User Manual** (**View or download the guides**), which opens the guides your administrator has published. The version of the app is printed at the bottom.

**Logout** is not really a tab. Tapping it asks **Are you sure you want to log out?** — tap **YES** to confirm. You are returned to the sign-in screen.

| What you tap | What happens |
| **Home** | Back to the tile grid |
| **Profile** | Who you are, which database, and the manuals |
| **Logout** | Asks to confirm, then signs you out |

| IMAGE 3 | Profile — the HELP card with User Manual, and the three tabs along the bottom

# PART 2   OPENING YOUR REGISTER

### Step 4  Open a Register

Tap **POS** on Home. This does **not** open a till — it opens **POS Register**, a list of the registers in your shop split into **Active Sessions** and **Available Registers**.

A register you have not started yet shows **AVAILABLE** and the line **Tap below to open this register and start a new session.** Tap **Open Register** on its card.

If nothing is listed you will see **No registers found.** — your administrator has not set a register up for you in Odoo.

| What you see | What it means |
| **AVAILABLE** | Nobody is selling on this register; you can open it |
| **ACTIVE** | A session is already running on it |
| **OPENING** | The session is being opened |
| **Session Closed** | This session has finished and cannot be sold on |

| IMAGE 4 | POS Register — an available register card with its Open Register button

### Step 5  Count the Drawer into Opening Control

Opening a register asks one question first. The **Opening Control** window shows **Opening cash** with the note **Cash currently in the drawer.**, and an **Opening note** box.

Count the money that is physically in the drawer and type it in. Add a note if you want one, then tap **Open Register**. If the figure is not a valid number you will be told **Invalid amount** — **Please enter a valid opening cash amount (0 or more).**

The app confirms with **Register Opened** and the session number.

> IMPORTANT  The opening figure is what your end-of-day cash count is measured against. Count the drawer properly — a guessed number here becomes a discrepancy at closing time.

| IMAGE 5 | The Opening Control window — Opening cash and Opening note

### Step 6  Carry On With a Session Already Open

If the register is already running, its card says **Continue Selling**. Tapping it asks how you want to carry on.

- **New Order** — **Open a clean register**. This is the normal choice.
- **Existing Order** — **Resume a draft from this session**. Use this to pick up an order somebody started and left unpaid.

The **⋮** menu on a register card also offers **Sessions** and **Orders** if you need to look back over the day.

### Step 7  Close the Register at the End of the Day

Closing is offered from the register card. If unpaid drafts are still sitting in the session the app will not let them vanish quietly — it warns that a number of draft orders must be paid or cancelled before close, and offers to discard them all and retry.

When the session closes you will see **Register Closed** and **Session closed successfully.**

> IMPORTANT  Deal with your drafts before you close. Discarding them throws the orders away — it does not park them for tomorrow.

# PART 3   BUILDING THE ORDER

### Step 8  Add Products to the Order

You arrive on the **Register** screen with an empty basket: **Cart is empty** and **Tap "Add Products" below to start building this order.**

Tap **Add Products**. The product screen has a **Search Products** box and a row of category chips such as **All (128)**, each showing how many products it holds.

There are three ways to add something:

- Tap the orange **+** on a product tile.
- Tap the tile to open it, then tap **Add to POS Cart**.
- Tap the QR button and scan the barcode.

Each addition confirms with **Added** and the product name. If the product is already in the basket you get **Already Added** instead, with the note that you should go back and increase the quantity. A barcode the till does not recognise raises **Product Not Found**.

When you are done, tap **Go to Register**.

| What you tap | What happens |
| **Search Products** | Filters the list as you type |
| Category chip | Shows only that category |
| **+** on a tile | Adds one of that product to the basket |
| **Add to POS Cart** | Adds the product you are looking at |
| **Go to Register** | Returns to the basket |

| IMAGE 6 | The Register screen with lines in the basket and the total beneath

| IMAGE 7 | The product picker — the search box, category chips and the orange + buttons

### Step 9  Change a Line

Back on **Register**, each line has **−** and **+** either side of its quantity.

Tap the quantity itself to open **Set Quantity** and type a number, then tap **Set**. Tap the price to open **Set Unit Price** the same way.

Two things about quantities are worth knowing before they surprise you. Quantities are whole numbers only — you cannot sell half of something from this screen. And **−** on a line showing 1 does not take it to zero, it removes the line; typing **0** into **Set Quantity** removes it too.

To clear several lines at once, press and hold a line to enter selection mode, tick the rest, and tap **Delete**.

> TIP  If the price is plain text rather than a tappable, dotted-underlined figure, your administrator has turned price editing off for your login. That is deliberate, not a fault.

### Step 10  Give a Discount

Tap a line to select it and a **Discount** chip appears, along with **Note** for a free-text note on that line.

The **Select Discount** window asks two things. **DISCOUNT TYPE** is either **Total Discount** (spread across the whole basket) or **Items Discount** (this line only). **DISCOUNT FORMAT** is **Percentage** or **Amount**. Then pick one of the preset buttons or type your own figure, and tap **Apply**. **Clear** takes the discount off again.

The discount shows under the total as a line beginning with **− Discount**.

> IMPORTANT  Apply discounts here, on the Register screen. The payment screen has a discount chip too, but in the normal **Place Order → Payment** route it is hidden — by then the total has already been fixed.

| IMAGE 8 | The Select Discount window — discount type, format and the preset buttons

### Step 11  Attach the Customer

At the bottom of the Register screen is a chip reading **Customer**. Tap it, find the person in the list, and tap their row. The chip then shows their name.

| What you tap | What happens |
| **Customer** chip | Opens the customer list to choose from |
| A customer row | Attaches them to this order and returns you here |
| The eye icon | Shows their details and ID proof without selecting them |

> IMPORTANT  Every sale needs a customer, not only sales on credit. If you try to finish without one the app opens **Customer Required** — **Please select a customer to validate the payment.** Attaching the customer here saves a detour later.

When the basket is right, tap **Place Order**. The order is saved as a draft — you will see **Draft saved** and its number — and the payment screen opens. An empty basket is refused with **Cart Empty** — **Add products before placing order**.

| IMAGE 9 | Choosing the customer from the Register screen

# PART 4   TAKING THE PAYMENT

### Step 12  Read the Payment Screen

The top of the **Payment** screen shows **TOTAL**. If a discount or tax applies, a breakdown appears beneath it — **Subtotal**, the discount line, and a **Tax** row you can tap to see it split line by line.

If the customer already owes money, an amber card appears under the total headed **Previous Due** with the amount outstanding. It is only there when there is something to show: no customer, or nothing owed, and the card stays hidden.

| What you see | What it means |
| **TOTAL** | What this order comes to |
| **Subtotal** | Before discount and tax |
| **Tax** | Tap it for the line-by-line breakdown |
| **Previous Due** | What this customer owed you **before** today's order |

| IMAGE 10 | The Payment screen — the total, and the amber Previous Due card beneath it

### Step 13  Take Cash or Card

Tap **Cash** or **Card**, then type the amount on the keypad. The keypad has **+10**, **+20** and **+50** shortcuts down the right-hand side, along with **+/−**, a decimal point and a backspace.

Watch the coloured pill as you type. It reads **Remaining** and an amount while you are short, **Exact amount** when it matches, and **Change** with an amount once you have taken more than the total.

If you try to finish while still short, the app opens **Amount Required** and tells you exactly how much more is needed.

### Step 14  Put It on the Customer's Account

Tap **Credit** for **CREDIT (CUSTOMER ACCOUNT)**. To take part of the money now, choose **Pay now via:** **Cash** or **Card** and type that part; the rest goes on the account. A live line shows **Credit (due):** with the amount and the customer's name, turning red if you have typed more than the order is worth.

> IMPORTANT  Credit needs a customer attached. Without one you will see the red hint **Customer required for Credit** and the sale cannot be validated.

### Step 15  Split Between Two Methods

**Split Payment** takes one order across two payments. The window shows **Total to collect**, then **Method 1** and **Method 2**, each offering **Cash** or **Card**.

Type an amount into each. A pill keeps score with **Entered** against the total, and the two figures must add up exactly before **Confirm** will accept them. The two methods must also be different.

> TIP  Credit is not offered as a split leg, and there are only ever two slots. To put part of a sale on account, use **Credit** with a **Pay now via** amount instead.

| IMAGE 11 | The Split Payment window — two method slots and the running total

### Step 16  Capture the Signatures

As soon as a customer is attached, the signature window rises by itself, headed with the customer's name and **Capture the customer and cashier signatures**.

There are two pads, **CUSTOMER SIGNATURE** and **CASHIER SIGNATURE**. Tap one, sign inside the box, and tap **SAVE**. **Pen**, **Eraser** and **Clear** are there if a signature needs redoing. Tap **DONE** when both are captured.

| IMAGE 12 | The signature capture window with the customer and cashier pads

### Step 17  Validate the Payment

Check the two tick boxes above the keypad before you finish. **Invoice** and **With Tax** are both on by default.

Turning **Invoice** off asks you to confirm, and the warning is worth reading: without the invoice, accounting cannot reconcile the transaction and the order will not appear in monthly VAT reports. Tap **Keep Invoice** unless you are certain.

Then tap **Validate Payment**.

> IMPORTANT  The app records where the sale happened, and it will not finish without a location. If location services are switched off, or the app has been refused permission, payment stops and offers **Open Settings** — there is no way past it. If the tablet simply cannot get a fix in time you are offered **Save without location** instead.

| What blocks you | What to do |
| **Customer Required** | Attach a customer, then validate again |
| **Amount Required** | Type the rest of the money |
| **Turn on location** | Open Settings and switch location services on |
| **Allow location access** | Open Settings and grant the app location permission |
| **No internet connection** | Reconnect and tap **Retry** — sales cannot be completed offline |

# PART 5   THE RECEIPT

### Step 18  Choose the Paper Size

The receipt screen opens with a green tick and **Order Placed**, the order number, and a preview of the paper.

The first time you tap **Preview**, **Download** or **Print**, the app asks **Choose receipt size** — **Pick a paper size. The receipt re-flows to fit the chosen size.** The list runs from **2 inch** (**50 mm**) up to **A4**, and one row may carry a purple **Default** badge. **Custom width (mm)** lets you type your own **Width (mm)** and tap **Use this size**.

If your administrator has switched on a default size, this window never appears — the receipt simply prints at that width.

| IMAGE 13 | The receipt screen — Order Placed, the order number and the paper preview

| IMAGE 14 | The Choose receipt size window, with the Default badge and Custom width

### Step 19  Preview, Download or Print

Along the bottom of the receipt sit the actions.

| What you tap | What happens |
| **Preview** | Opens **Print Preview** — the receipt exactly as it will print |
| **Download** | Saves the receipt as a PDF; you choose the folder |
| **Print** | Hands the receipt to the tablet's printing service |
| **PDF (Credit)** | Downloads the accounting invoice; only shown when the order has one |
| **Location** | Shows where the sale was made |
| **Done** | Clears the basket and returns you to Home |

If the customer still owes money, the printed receipt carries three extra lines — **Previous Due**, **This Invoice** and **Total Due** — so they can see the whole picture.

> TIP  The preview drawn on the screen is always the app's own plain layout. If your shop has been set up with a branded or bilingual receipt, that design shows up in **Preview**, **Download** and **Print** — not in the on-screen block.

> IMPORTANT  **Done** ends the sale. You cannot go back to the payment screen afterwards, and neither can the tablet's back button. Print or download whatever you need before you tap it.

### Step 20  See Where a Sale Happened

Tap **Location** for **Order Location**, showing **Latitude** and **Longitude** and an **Open in Maps** button. On the receipt itself the position appears under **LOCATION**, either as a place name or as coordinates.

# PART 6   ORDERS AND RETURNS

### Step 21  Find a Past Order

Tap **Orders** on Home. **Search Orders** looks in the order number, the customer and the salesperson, and four chips filter the list: **All**, **Paid**, **Draft** and **Cancelled**.

Each row shows the order number, a status badge, the amount, the customer, the receipt number and the date. Refunds carry a red **REFUND** badge. An empty list says **No orders found**.

| Badge | What it means |
| **New** | A draft — not paid yet |
| **Paid** | Payment taken |
| **Posted** | Finished and booked |
| **Invoiced** | An accounting invoice exists for it |
| **Cancelled** | Abandoned |
| **REFUND** | This order gives money back |

Tapping a **draft** loads it back into the basket so you can finish it. Tapping any other order opens it read-only.

> TIP  There is no date filter on this screen. To look at a period, use **Sales Report** instead.

| IMAGE 15 | The Orders list — status badges, a REFUND row and the search box

### Step 22  Read an Order

The order screen shows the number, the receipt reference and a status pill, then **DATE**, **CUSTOMER**, **SALESPERSON** and **REGISTER**, the **ITEMS**, the totals and the payments taken.

Along the bottom are **Preview**, **Download**, **Print**, **Tax Breakdown** and **Location**. A greyed-out **Location** chip means the order has no position stored; tapping it says **No location**.

| IMAGE 16 | An order opened from the list, with its items, totals and action chips

### Step 23  Send Products Back

Open the original paid order and tap **Return Products**. The app asks **Return Products?** and explains that a new refund order will be created with negative quantities, ready for payment. Tap **RETURN**.

The refund order is created — **Products returned**, **Refund order created — ready for payment.** — and loaded straight into the basket. Take the payment as usual to give the money back.

**Return Products** only appears when a return is actually possible. It is hidden on drafts, on cancelled orders, on refunds themselves, and on any order that has already been returned once. You also need an open session: without one you get **Invalid Operation** telling you to open a session on that register first.

> IMPORTANT  Returning brings back **every** line at its full quantity. To refund only part of an order, delete the lines you are not refunding — do not try to edit the quantities. On a return line **−** removes the line altogether and **+** makes the refund smaller, and a negative quantity cannot be typed in.

The refund keeps whatever tax was charged originally, scaled to what you are giving back, so a return always reverses exactly what was taken.

| IMAGE 17 | The Return Products confirmation

# PART 7   CUSTOMERS

### Step 24  Find a Customer

Tap **Customers** on Home and use **Search Customers**. Each row shows the name, the phone or email, and two small badges for whether their ID proof is on file — **ID Proof F** for the front and **ID Proof B** for the back, ticked when the image is there.

| IMAGE 18 | The Customers list with the ID-proof badges

### Step 25  Add or Change a Customer

Tap the orange **+** for **New Contact**, or the pencil on a row for **Edit Contact**.

Choose **Person** or **Company** at the top, then fill in what you know. Only one field is compulsory.

| Field | Do you have to fill it in? |
| **Name \*** | **Yes** — the only required field. Leaving it empty gives **Name is required** |
| **Email** | No |
| **Phone** | No. The dial code button defaults to **+968**, and a hint shows how many digits that country expects |
| **Company**, **Job Position** | No — shown for a Person |
| **Street**, **Street 2**, **City**, **ZIP** | No — under **Address** |
| **Tax ID**, **Website** | No — under **Other** |
| **ID Proof** | No — front and back photos |

Tap **Save**. You will see **Contact created** or **Contact updated** and be returned to the list.

> TIP  Nothing else is validated. An email with no `@`, or a phone number that is too short, will save without complaint — so it is worth reading the details back before you tap Save.

| IMAGE 19 | The New Contact form with the mandatory Name field

### Step 26  See What a Customer Owes

There is no balance on the customer record itself. What a customer owes shows up in three places instead: the amber **Previous Due** card when you take their payment, the **Previous Due** / **This Invoice** / **Total Due** lines on their receipt, and in full under **Partner Ledger**.

# PART 8   PRODUCTS AND STOCK

### Step 27  Look Through the Products

Tap **Products** on Home. **Search Products** filters the grid, and category chips narrow it further. A line under the search box counts what you are looking at, for example **Showing 40 of 128**.

Each tile shows the picture (or **No Image**), the stock figure in a green or red badge, the name and the price.

| IMAGE 20 | The Products list — the search box, the category chips and the count line

### Step 28  Add or Change a Product

Tap the orange **+** for **New Product**, or open a product and tap **Edit Product**.

| Field | Do you have to fill it in? |
| **Product Name \*** | **Yes** — the only field actually enforced |
| **Category \*** | Starred, but the app will save without it |
| **Sales Price**, **Cost** | No |
| **Unit of Measure** | No |
| **Track Inventory** | No — tick it to hold a stock figure for this product |
| **On Hand Quantity** | Only when **Track Inventory** is ticked |
| **Barcode**, **Internal Reference** | No |

Tap **Save Changes**. If nothing has changed the button stays dimmed and will not respond — that is the app telling you there is nothing to save, not a fault.

| IMAGE 21 | Edit Product — Track Inventory ticked, and Save Changes dimmed because nothing has changed yet

### Step 29  Put a Product in Several Categories

Tap the **Category \*** row for **Select Category**. The rows are tick boxes, so you can choose several and the window stays open while you do. The chosen names come back joined together in the field.

**Add Category** at the bottom creates a new one — **Category Name \*** and a **Colour** — and whatever you typed in the search box is used as the starting name.

> TIP  Categories can be created and renamed here but never deleted, and this is the only place in the app where you can manage them.

| IMAGE 22 | The Select Category picker with several categories ticked

### Step 30  Sell in a Different Unit

Tap **Unit of Measure**, then **Add Unit** for **New Unit of Measure**.

Give it a **Unit Name \***, choose a **Reference Unit**, and say how many of that unit it **Contains**. A line underneath does the sum for you as you type — with a pack of twenty referencing Units it reads **1 Pack of 20 = 20 Units**.

> IMPORTANT  Once a product with this unit has been bought or sold, Odoo will not let the ratio change. If a saved change comes back as **Some changes did not save**, this is usually why.

| IMAGE 23 | The New Unit of Measure window and the line that does the sum

### Step 31  Count in Dozens

Tick **Dozen Display** on a product you are tracking. Two boxes appear — **Pieces per Dozen** and **On Hand (Dozens)** — with a running total beneath them in the form **= 9 Dozen 7 Pcs**.

Typing into **On Hand (Dozens)** asks you to confirm the change to the piece count before it is written. The product's own screen then carries an **On Hand (Dozen + Pcs)** row.

| IMAGE 24 | Dozen Display switched on, with the Dozen and Pcs readout

### Step 32  Retire a Product You Cannot Delete

Open the product and tap **Delete Product**, then **OK**.

A product that has already been sold cannot be deleted. The app opens **Can't Delete Product** with the reason, and offers **ARCHIVE INSTEAD** — which hides it without destroying its history. You will see **Product archived**.

To find it again, tap **Show Archived** on the Products list; the counter changes to **Archived · Showing 3 of 3**. Open it and tap **Restore Product** to bring it back. **Show Active** returns to the normal list.

| IMAGE 25 | The Can't Delete Product box, offering ARCHIVE INSTEAD

### Step 33  Check Stock

**Stock** on Home lists what you hold, with **Search Stock** and the filters **All**, **In Stock**, **Low Stock** and **Out of Stock**. You can export the list as **PDF** or **Excel**. Opening a line shows **ON HAND**, **FORECAST**, **Locations** and **Last Movement**.

| IMAGE 26 | The Stock list with its filter pills

# PART 9   BUYING AND RETURNING STOCK

### Step 34  Record What You Buy

Tap **Easy Purchase** on Home, then the **New Purchase** button.

Fill in **Purchase Header** — **Vendor \***, **Date \***, an optional **Vendor Reference**, and the **Discount Type**. Then **Payment & Warehouse** — **Payment Method \*** and **Warehouse \***.

Only then can you add goods. Until a vendor and a payment method are both set, the product area is locked and says **Select a vendor and a payment method first to start adding products.**

Tap **Add Line** for each product, giving **Product \***, **Quantity \*** and **Unit Price \***. Then **Save** to keep it as a draft, or confirm it outright.

| What you tap | What happens |
| **Save** | Keeps the purchase as a draft you can come back to |
| **Confirm Order** | Commits it — stock and the vendor bill follow automatically |
| **Cancel Purchase** | Abandons a draft |

> TIP  There is no goods-receipt screen. Confirming the purchase creates and completes the stock receipt for you; the finished purchase shows it back as a read-only **Receipt** row under **Linked Records**.

| IMAGE 27 | The Easy Purchase form — header, payment and warehouse, and the product lines

### Step 35  Send Goods Back to a Vendor

Tap **Quick Return** on Home, then **New Return**.

Pick the **Vendor Bill \*** you are returning against — **Tap to pick a posted vendor bill**. The lines load underneath, each showing four figures.

| Column | What it tells you |
| **Purchased** | How many you bought on that bill |
| **Already Returned** | How many have gone back before |
| **Max Returnable** | The most you can still send back |
| **Return Qty** | How many you are returning now — type this in |

**Return all** at the top of the card fills in the maximum on every line. When the figures are right, tap **Confirm Return**.

> IMPORTANT  You cannot return more than you bought. Type too much and the app says **Quantity exceeds maximum**, explains the limit and snaps the figure back down; while any line is over, **Confirm Return** stays greyed out.

Once a return has been created its source bill is locked and shows a padlock — you cannot point it at a different bill afterwards.

| IMAGE 28 | Quick Return — Purchased, Already Returned, Max Returnable and Return Qty

# PART 10   MONEY

### Step 36  Look at Invoices

**Invoices** on Home lists your customer invoices. **Search by invoice # or customer** finds one, the tabs **All**, **Posted**, **Draft** and **Cancelled** narrow the list, and **Filters** and **Group By** refine it further.

Opening an invoice shows **Total Amount**, then **Customer**, **Invoice Date**, **Due Date**, **Journal** and the rest, the **Amounts** block ending in **Amount Due**, a **Payment Status** badge, and the **Invoice Lines**.

Two buttons produce a PDF and they are not the same:

| Button | What you get |
| **Download PDF** | Odoo's own invoice document, as the back office would print it |
| **Print PDF** | The same invoice through **your shop's** receipt design and paper size |

| IMAGE 29 | The Invoices list with the Filters and Group By pills

### Step 37  Read the Partner Ledger

**Partner Ledger** shows every posted movement per customer or supplier, in columns from **Date** through **Debit**, **Credit** and **Balance**. A **Total** row is pinned at the bottom and sums whatever you are currently looking at.

**Filters** opens the full set — **Posting Status**, **To Review**, **Reconciliation**, **Journal**, **Accounts**, and a **Date** section offering periods against either **Date** or **Invoice Date**. Each filter you pick appears as a chip above the table; tap a chip to remove just that one.

Tapping any row opens the invoice behind it.

| IMAGE 30 | Partner Ledger with the Filters box open and chips above the table

### Step 38  Record an Expense, and Check the Day

**Expenses** on Home records money going out. **Sales Report** builds a report over a period you choose and is the place to look at a date range — the Orders list has no date filter.

| IMAGE 31 | The Sales Report screen

# QUICK REFERENCE

## Where Things Live

| To do this | Go here |
| Sell something | **POS** → open a register → **Add Products** → **Place Order** |
| Find a past sale | **Orders** |
| Refund a sale | **Orders** → open the paid order → **Return Products** |
| Look at a period | **Sales Report** |
| Add or edit a customer | **Customers** |
| See what a customer owes | **Partner Ledger**, or the **Previous Due** card at payment |
| Add or edit a product | **Products** |
| Bring an archived product back | **Products** → **Show Archived** → **Restore Product** |
| Check what you hold | **Stock** |
| Record a purchase | **Easy Purchase** |
| Send goods back to a vendor | **Quick Return** |
| Read the manuals | **Profile** → **User Manual** |

## Things to Remember

- **Every sale needs a customer.** Attach them on the Register screen and save yourself the detour.
- **Location must be available.** With location switched off or refused, payment simply will not complete.
- **There is no offline mode.** Lose the network and selling stops until it comes back.
- **The basket does not survive a restart.** Finish or discard an order before closing the app.
- **Apply discounts on the Register screen**, not at payment.
- **Returns bring back every line.** Delete what you are not refunding rather than editing quantities.
- **An order can only be returned once**, and only while the register's session is open.
- **Count the drawer honestly at opening.** Everything at closing is measured against that number.
- **Clear your drafts before closing the register**, or they will have to be discarded.
- **Done ends the sale.** Print or download before you tap it.
- **A missing tile is usually a privilege, not a fault.** Ask your administrator.

=== Open the register, sell, take the money, hand over the receipt. Everything else in this guide hangs off those four things.

@@ END

%% BOOK: Administrator Guide | Connect the tablets, decide who sees what, and design the receipt your shop prints.

## About This Guide

This is the second half of the document, for whoever owns the system: connecting tablets to your server, deciding which parts of the app each person can see, and designing the receipt and invoice your shop hands out.

It assumes you have an Odoo administrator login, and that somebody has installed the custom modules listed in PART 6 — without those, several screens in this guide either do not appear or refuse to work.

> IMPORTANT  Most of this only works if your Odoo user's role is **Administrator**. The five **Administration** tiles check for it and refuse with **Only administrators can access this feature** otherwise.

## The Administrator's Job at a Glance

- **Once per tablet** — connect it to the server and register it against a QR code.
- **Once per person** — create their Odoo login, then hide whatever they should not see.
- **Once per company** — choose the invoice template, set up paper sizes, and design the layout.
- **Whenever you like** — change the Home banners and publish the manuals.

# PART 1   CONNECTING A DEVICE

### Step 1  Set the Server and Database

A tablet that has never been configured opens on **Device Setup** rather than the sign-in screen.

Work down the three steps. **Server URL** takes the address of your Odoo server — **Enter the URL (http:// or https://)**. Leave the box and the app fetches the databases from it, which you then choose under **Database**. Finally give **Admin Credentials** — a **Username** and **Password** with administrator rights.

Tap **Configure Device**.

| If you see this | What is wrong |
| **Could not fetch databases — check the URL and try again** | The address is wrong or unreachable |
| **Connection timed out — is the server running?** | The server is not answering |
| **Cannot reach server — check the IP address and port** | Wrong host or port |
| **Server found but database listing is disabled or module not installed** | Odoo is not exposing its database list |
| **Invalid username or password** | The administrator credentials are wrong |
| **Device Module Not Installed** | `device_login_config` is missing on the server |

| IMAGE 32 | Device Setup — Server URL, Database and Admin Credentials

### Step 2  Register the Tablet by QR

After the details are accepted the app asks **Ready to scan?**. Tap **Scan QR** and point the camera at the registration code generated in Odoo for this device. The status line reads **Point camera at the QR code on the admin screen**, then **QR detected — registering device…**, then **Device registered! Redirecting…**, and the tablet lands on the sign-in screen.

| If you see this | What it means |
| **Invalid QR** | That code is not a device registration code |
| **Wrong Database** | The code was generated for a different database than the one you chose |
| **QR Already Used** | Another tablet has claimed this code |
| **Device Blocked** | The device is blocked in Odoo |
| **Cannot Reach Server** | The server did not answer during registration |

> IMPORTANT  The QR code is tied to one database. If you picked the wrong database on the previous screen, either go back and change it or ask for a new code generated from the right one.

| IMAGE 33 | The QR scanner registering a device

### Step 3  Get Back to Device Setup Later

Once a tablet is registered there is no menu item that returns you to Device Setup — the screen is deliberately hard to reach so a cashier cannot wander into it.

The way back is a hidden gesture: on the sign-in screen, tap the words **Welcome back** seven times. A gear appears in the top-right corner; tapping it returns you to **Device Setup**, where you can repoint the tablet at a different server or database without wiping the app.

### Step 4  Know When a Device Gets Thrown Out

The app re-checks its registration every few seconds and whenever it comes back to the foreground. If you block or deactivate the device in Odoo while somebody is using it, they are signed out on the spot and returned to Device Setup with either **Device blocked (Serial …). Contact your administrator.** or **This device's session ended. Please reconnect by scanning the QR.**

This is how you retire a lost or stolen tablet: block it in Odoo and it locks itself within seconds.

# PART 2   PEOPLE AND WHAT THEY SEE

### Step 5  Create the People

**Users** on Home lists everyone, split into **ADMINISTRATORS** and **USERS**, with **Search by name or login**. **New User** creates one; tapping a row edits it.

| IMAGE 34 | The Users list, split into administrators and users

### Step 6  Hide What People Should Not See

**Apps Privileges** is where you decide what each person's app looks like. Choose somebody under **Pick a user** — **Choose whose visibility you want to manage** — and you get the whole catalogue of features, grouped into headings such as Home Tiles and Accounting Invoices.

Each row is a switch between **Visible** and **Hidden**. **Hide All** and **Reset All** do the obvious thing to everything at once. Tap **Save** when you are done.

Two things about this screen matter more than anything else on it.

> IMPORTANT  This is a **hide** list, not a permission list. Everything is visible by default; you are switching things off. And a hidden feature does not grey out — it disappears entirely, taking its section heading with it if nothing else is left in that section. Tell your staff, or you will field bug reports about missing buttons.

> IMPORTANT  Hiding has no effect at all on an Odoo administrator. The screen warns you: **This user is an administrator — privilege rules will NOT apply**. To make privileges bite, open Odoo, go to **Settings → Users & Companies**, and change that person's role from **Administrator** to **User**.

Changes are not instant either. The banner on the screen says it plainly: **Visibility changes apply on the user's next login.** The person has to sign out and back in.

| What you can hide | Examples |
| Home tiles | **POS Tile**, **Products Tile**, **Invoices Tile**, **Partner Ledger Tile** |
| Actions | **Add**, **Edit**, **Change Password**, **Resume Draft**, **Export PDF** |
| POS controls | **Open Register**, **Close Register**, **POS - Edit Line Price** |
| Invoice actions | **Invoice - Pay**, **Invoice - Confirm & Post**, **Invoice - Cancel** |
| Journals | **Journals - Sales**, **Journals - Purchases**, **Journals - Bank & Cash** |
| Whose data they see | **See All Users' Data** |

**See All Users' Data** deserves singling out. Switch it off for somebody and they stop seeing everyone else's records in Orders, Invoices, Journal Entries and Partner Ledger — they see only what they created themselves. It is the closest thing the app has to a data-level role.

> TIP  Hiding all four journal types leaves the **Journal Entries** tile in place but its **Select Journal** window opens empty. Hide the **Journal Entries Tile** itself instead.

| IMAGE 35 | Apps Privileges — a user chosen, and features switched between Visible and Hidden

# PART 3   INVOICE SETTINGS

### Step 7  Open the Settings for a Company

**Invoice Settings** on Home lists one entry per company. Open one and you reach a hub of three cards.

| Card | What it covers |
| **General Settings** | Invoice template, branding, logo, toggles and the default receipt size |
| **Receipt Paper Sizes** | Add, edit and reorder the paper sizes your shop prints on |
| **Invoice Layouts** | Preview each size's custom block layout |

> IMPORTANT  All of this is provided by the `pos_dynamic_invoice` module. Without it the list refuses to open and tells you **Dynamic Invoice module is not installed on the server**.

| IMAGE 36 | The Invoice Settings hub — General Settings, Receipt Paper Sizes and Invoice Layouts

### Step 8  Choose the Invoice Template

**General Settings** opens with **Invoice Template** — **Choose which receipt the app shows.** There are four.

| Template | What it gives you |
| **Standard** | The app's built-in receipt — nothing to configure |
| **Dynamic** | Branded receipt with logo, VAT number and custom header and footer |
| **Cash Memo** | Bilingual English/Arabic invoice, sized for A4 or A5 |
| **Custom Layout (editable)** | A drag-and-drop block layout, designed per paper size |

**Preview** renders the chosen template against your most recent order. It is not offered for **Standard**, which has nothing to preview.

> TIP  Whichever template you pick, the block the cashier sees on the receipt screen is always the plain built-in layout. Your design shows up in **Preview**, **Download** and **Print**. That is expected — do not chase it as a fault.

| IMAGE 37 | General Settings — the Invoice Template choices

### Step 9  Fill In the Branding

For **Dynamic**, the **Branding** card carries **Address**, **Phone**, **Email** and **VAT / GST Number**, each falling back to the company's own details when left blank. **Header & Footer** sets the **Header Title** and **Footer Text**. **Show / Hide on Receipt** switches the **Tax row**, **Customer signature**, **Cashier signature** and **Footer** on and off. **Logo** uploads the image and decides whether it appears on the invoice, the receipt, or both.

For **Cash Memo**, the **Cash Memo Header** card drives the bilingual header — **These appear on the bilingual invoice header. Leave blank to hide a line.**

| Field | Its switch |
| **Company Name (English)** and **Company Name (Arabic)** | **Show Company Name** |
| **C.R. Number** | **Show C.R. Number** |
| **GSM / Mobile** | **Show GSM / Mobile** |
| — | **Show Sultanate of Oman** |
| **VAT Number** | **Show VAT Number** |

Tap **Save Settings** when you are done.

| IMAGE 38 | The Cash Memo Header card with its show and hide switches

### Step 10  Decide Whether Cashiers Get Asked About Size

**Use Default Receipt Size** controls one thing: whether the cashier sees the size window on every print. The screen explains it exactly — on, and **Preview**, **Download** and **Print** use the size below without asking each time; off, and the app asks for a size each time.

Switch it on and pick a **Default Size**.

> TIP  Turning this on is the single biggest speed-up you can give a busy till. Leave it off only if the shop genuinely prints on more than one paper size during the day.

# PART 4   PAPER SIZES AND LAYOUTS

### Step 11  Set Up the Paper Sizes

**Receipt Paper Sizes** lists the widths your shop prints on. The screen tells you how it works: enter the size in inches and the width in millimetres fills in automatically, and a height of 0 means one continuous page.

Tap **New** for **New Paper Size**, give it a **Size (inch)**, adjust **Width (mm) — auto from inch** if you must, and set **Height (mm) — 0 = auto**. The chevrons on the left reorder the list — that order is what cashiers see in their size window.

> IMPORTANT  One entry per company is marked **Custom** and shows a padlock instead of the edit and delete buttons. It cannot be renamed, edited or deleted — only moved up and down. It is what backs the **Custom width (mm)** option on the cashier's size window.

A size that is in use as a default cannot be removed; the app says **Delete failed (it may be in use as a default).**

| IMAGE 39 | Receipt Paper Sizes, with the locked Custom entry

### Step 12  Design a Layout

**Invoice Layouts** lists one layout per paper size, each tagged **Grid** or **Flow**. Open one to see its blocks and **Open Visual Editor**.

> IMPORTANT  Layouts only reach the printed receipt when **Invoice Template** is set to **Custom Layout (editable)** in General Settings. Designing one and leaving the template on Standard changes nothing.

| IMAGE 40 | The Invoice Layouts list, with each size tagged Grid or Flow

### Step 13  Use the Visual Editor

The editor is a landscape screen in three panels: **Design** on the left, **Options** in the middle and **Live Preview** on the right. Tap a block in Design and its settings appear in Options — **Tap a section to edit it.** until you do.

The toolbar carries **Save**, **Undo**, **Redo**, a **Grid**/**List** switch, **Add** and **Reset**.

Every block has **Visible**, **Align** and **Direction**. In grid mode you position it with **X (cm)**, **Y (cm)**, **Width (cm)** and **Height (cm)**; in list mode you only set **Width %**. Text blocks add **Label (English)** and **Label (Arabic)**; the barcode block asks what it should encode.

The blocks available are the parts of a receipt: **Logo**, **Company Name (English)**, **Company Name (Arabic)**, **Company Header**, **Title**, **Order Fields (No / Date / Customer)**, **Items Table**, **Totals**, **Payments**, **Signatures**, **Footer**, **Barcode**, **QR Code** and **Custom Text**.

> IMPORTANT  Two blocks are shared. The editor warns you with **Company-wide — shared by every layout.** and **Company Header rows — shared by every layout.** Editing them in the A4 layout changes them in the 3-inch layout too.

> TIP  Your edits are written as you make them — there is no save-or-lose-it moment. The **Save** button refreshes the preview and confirms with **Saved**. In grid mode the banner reminds you that **Grid = fixed positions; use List for print-exact.**

| IMAGE 41 | The Visual Editor in landscape — Design, Options and Live Preview

# PART 5   BANNERS AND THE MANUAL

### Step 14  Change the Home Banners

**App Banners** manages the carousel across the top of everybody's Home screen. Each banner shows as **Active** or **Inactive**.

**New Banner** opens a form with a **Name**, an **Active** switch, and **Pick from gallery** for the image. **Delete banner** asks **Delete banner?** and warns that it permanently removes the banner from the carousel.

| IMAGE 42 | The App Banners list

### Step 15  Publish the Manuals

**User Manual** holds the guides your staff can read on the tablet. Tap **Add** for **Add Document**, give it a **Title**, tap **Choose PDF**, and save. Tapping any document offers **View** (**Open it in your PDF app**) or **Download** (**Save a copy to your device**).

If the screen says **The manual feature is not set up on this server yet.** the `app_user_manual` module is missing.

| IMAGE 43 | The User Manual screen with its document list

### Step 16  Decide Whether Staff See the Manual

On **Profile**, under **HELP**, administrators get a second row: **Show to users**. Switched on it reads **Users can see the manual**; switched off, **Hidden for users (you always see it)**.

> IMPORTANT  This switch is stored on the tablet, not on the server and not against a person. Turning it off on one tablet hides the manual for everybody who uses **that** tablet, and leaves every other tablet untouched. Administrators always see the manual whatever the switch says.

# PART 6   WHAT IS SET UP IN ODOO

### Step 17  Install the Modules

The app leans on eleven custom Odoo modules. Some are optional; two of them the app cannot start without.

| Module | What it turns on in the app |
| `device_login_config` | Device Setup and QR registration. **Without it no tablet can be configured at all** |
| `user_privilege_manager_apps` | The whole Apps Privileges system and the feature catalogue |
| `pos_dynamic_invoice` | Invoice Settings, receipt paper sizes and invoice layouts |
| `app_banner` | The Home banner carousel and the App Banners screen |
| `app_user_manual` | The User Manual screen and the HELP card on Profile |
| `easy_purchase_apps` | The Easy Purchase tile and its screens |
| `quick_purchase_return_apps` | The Quick Return tile |
| `pos_order_location` | Recording where each sale happened, and the receipt's location line |
| `pos_total_discount` | The whole-order discount button in POS |
| `product_dozen_display` | The Dozen Display fields and the **Dozen + Pcs** readout |
| `hr_expense_payment_method` | The payment-method field on Expenses |

### Step 18  Do the Things the App Cannot Do for You

Some setup has no in-app equivalent at all.

| In Odoo you must | Or else |
| Pre-register each device and generate its QR code | The tablet cannot be configured |
| Expose the database list | Device Setup cannot fetch the databases |
| Load the feature catalogue into Privilege Manager | Apps Privileges shows **No features defined yet** |
| Change a person's role from Administrator to User | Their privilege switches are silently ignored |
| Create an invoice settings record per company | Invoice Settings has nothing to open |
| Set up POS payment methods on each register | Payment fails — the register has no method configured |
| Upload the manual PDFs | The User Manual screen is empty |

> TIP  When a cashier reports that something has vanished, work down three things in order: is the tile hidden for their login, is their Odoo role still **Administrator** (which ignores privileges entirely), and have they signed out and back in since you changed anything.

# QUICK REFERENCE

## Where Things Live

| To do this | Go here |
| Connect a new tablet | **Device Setup** — first run, or seven taps on **Welcome back** |
| Retire a lost tablet | Block the device in Odoo; it locks itself within seconds |
| Create a login | **Users** → **New User** |
| Hide something from somebody | **Apps Privileges** |
| Limit somebody to their own records | **Apps Privileges** → **See All Users' Data** → off |
| Choose the receipt design | **Invoice Settings** → **General Settings** → **Invoice Template** |
| Stop cashiers being asked about paper size | **General Settings** → **Use Default Receipt Size** |
| Add a paper size | **Invoice Settings** → **Receipt Paper Sizes** → **New** |
| Design a receipt | **Invoice Layouts** → **Open Visual Editor** |
| Change the Home carousel | **App Banners** |
| Publish a guide | **User Manual** → **Add** |

## Things to Remember

- **Privileges hide, they do not grant.** Everything is visible until you switch it off.
- **Privileges do not apply to administrators.** Demote the person to **User** in Odoo first.
- **Changes take effect at next login**, not immediately.
- **A hidden tile disappears silently**, along with its section if nothing is left.
- **The QR code is tied to one database.** A code from the wrong database will be refused.
- **Blocking a device in Odoo throws its user out within seconds.** That is your remote wipe.
- **The locked Custom paper size cannot be edited or deleted**, only reordered.
- **Layouts only print when the template is Custom Layout (editable).**
- **The company header blocks are shared by every layout.** Editing one edits all.
- **Show to users lives on the tablet**, not on the person or the server.
- **Missing module, missing screen.** Every "not installed" message means exactly what it says.

=== Connect the tablet, decide what each person sees, design the receipt once. After that the shop runs itself.

@@ END
