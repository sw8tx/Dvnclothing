# DVN checkout setup

Implemented: account carts with optimistic concurrency, server-priced quotes,
owned 15% first-order codes, atomic stock reservation, durable orders, hosted
Stripe card checkout, PayPal approval/capture, verified webhooks and order status.
The shop remains a password-protected preview. Payment credentials are absent;
no real checkout is enabled by this commit.

## Database

`migrations/0006_commerce.sql` extends `DVN_AUTH_DB` after migrations 0001–0005.
It seeds exactly five units in S, M and L for each of the five catalog products
(75 total). `INSERT OR IGNORE` never resets existing stock on a rerun.
Applied to production `dvn-auth` on 2026-11-22; 15 inventory rows, three new
tables and three triggers verified through the Cloudflare console.

There are no schema changes per customer request. Stock is reduced in a single
transaction by the insert trigger; cancellation restores it once. A cart itself
does not reserve anything. A matching, unchanged account cart is cleared when
payment is verified; a newer selection on another device is retained.

## Credentials and activation

Use Cloudflare Pages **dvnclothing → Settings → Variables and Secrets**. Never
commit credentials or send them in chat. Configure production and preview
environments separately. Keep `COMMERCE_ENABLED=false` until testing is complete.

| Variable | Purpose |
| --- | --- |
| `COMMERCE_ENABLED` | Explicit `true` to enable provider checkout |
| `COMMERCE_MODE` | `test` or `live`; no implicit live default |
| `STRIPE_CHECKOUT_TEST_SECRET_KEY` | Dedicated `sk_test_…` for checkout tests; the old welcome-bonus key is never used |
| `STRIPE_LIVE_SECRET_KEY` | Production `sk_live_…` |
| `STRIPE_CHECKOUT_WEBHOOK_SECRET` | Matching endpoint's `whsec_…` |
| `PAYPAL_CHECKOUT_CLIENT_ID` | REST application for the selected environment |
| `PAYPAL_CHECKOUT_CLIENT_SECRET` | Secret for that same application |
| `PAYPAL_MERCHANT_ID` | Expected receiving merchant ID |
| `PAYPAL_WEBHOOK_ID` | Registered webhook ID in that environment |
| `COMMERCE_LEGAL_READY` | Set `true` only after the seller has completed the actual sales terms, withdrawal information, tax treatment and payment privacy information |

Live sessions also remain blocked until catalog launch time
`2026-12-06T00:00:00+01:00` and require confirmed inventory and shipping.
Sandbox checkout must use a separate D1 database with these migrations and test
accounts. Sandbox reservations and paid orders also consume that database's
stock. Never run sandbox sales against the production inventory or reuse a
production database when switching payment environments.

Shipping is Germany only, €4.90, 3–5 business days. Prices are server catalog
values. The discount is 15% of the item subtotal, rounded in cents, excluding
shipping. No reusable provider-wide discount is exposed. Stripe receives
discounted line amounts; PayPal receives item/discount/shipping breakdowns.

## Webhooks

Register these exact HTTPS endpoints:

- Stripe: `https://dvnclothing.com/api/payments/stripe`
  events `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_succeeded`.
- PayPal: `https://dvnclothing.com/api/payments/paypal`
  events `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`.

Only these webhook routes are exempt from the browser Origin requirement.
Stripe's raw-body HMAC is verified with a five-minute timestamp tolerance.
PayPal uses its server-side verify-webhook-signature API. An event never supplies
trusted prices or ownership: the handler fetches the provider's current order
and matches merchant/order/amount/currency/mode/shipping before marking paid.
Repeated notifications cannot debit stock or clear a cart twice.

Provider returns go to `/api/payments/return`. That public page has no order data,
does not mark anything paid and does not bypass the preview gate. Its link resumes
same-origin navigation to the authenticated order overview. Customer sessions
and the shared launch password remain separate.

## Required merchant acceptance test before release

Use real sandbox accounts to test both providers: a successful purchase, browser
closure before return, webhook replay, cancel, insufficient stock, a code owned
by another account, a previously redeemed code and non-German shipping. Verify
amounts and receiving merchant in the provider dashboard. Local tests use mocked
provider responses; real provider tests cannot run without merchant credentials.
Confirm the hosted checkout's legally required order summary and button text,
tax settings and customer receipt settings with the seller before activation.
The existing public terms deliberately still say sales are closed. Update the
sales/withdrawal/payment privacy texts before setting `COMMERCE_LEGAL_READY`.

## Operations and limitations

- Orders and fulfilment addresses are in `shop_orders`; only `status='paid'`
  means payment was verified. A redirect, approval, pending capture or cart is
  not a paid order. Fulfilment and refunds are managed manually in the merchant
  dashboards; no shipping or refund automation is implemented here.
- Stripe sessions expire after one hour and the signed expiration event releases
  stock. If webhook delivery is delayed, use the customer's status refresh or
  replay the provider event. A new request never frees an uncertain Stripe hold.
- PayPal pending approvals expire after one hour and are released on a subsequent
  checkout attempt or completion check. Only this server captures them; its
  atomic state transition prevents an expired/cancelled approval from charging.
- Network errors during creation/capture retain the reservation. A retry uses
  the same provider idempotency key. Old ambiguous creation attempts and captures
  stuck in `capturing` need provider reconciliation. Do not manually release
  stock until the provider confirms no payment can complete. A timed-out capture
  is queried, never retried as a second charge.
- One unfinished checkout per customer/address and linked account is permitted.
  The customer can resume or cancel it from the order overview.
- Account carts have no polling loop. Failed saves are marked unsynced and kept
  locally with their version; a conflict does not silently overwrite another
  device. The user can explicitly load the saved account cart.
- Deleting local browser data does not delete the server account cart. Removing
  items in a signed-in cart updates it after successful sync.
- No Shop Pay integration is claimed. PayPal and Stripe are the chosen providers;
  wallet availability depends on the merchant's Stripe configuration and device.

Official references: [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[Stripe webhook signatures](https://docs.stripe.com/webhooks/signature),
[PayPal Orders](https://developer.paypal.com/api/orders/v2),
[PayPal webhook verification](https://developer.paypal.com/api/webhooks/v1).

## Operator orders and Discord notifications

Apply `migrations/0007_order_notifications.sql` after 0006. It is additive and
idempotent; it does not replenish stock. Set these **production** variables:

- `DISCORD_ORDER_WEBHOOK_URL`: encrypted Cloudflare Secret. Never commit it,
  include it in client code, logs or customer responses.
- `COMMERCE_ADMIN_EMAILS`: comma-separated verified sign-in addresses permitted
  to view all orders. Empty means no administrator. Do not use a shared mailbox.

Open `https://dvnclothing.com/admin/orders`, enter the preview password and sign
in using the configured operator account. The API checks the server allowlist
on every request; the preview password alone is insufficient. Orders paginate
20 at a time. No periodic database polling is used.

**Discord-Testbestellung senden** creates a synthetic notification only, using
`example.invalid` and an unmistakable `TESTBESTELLUNG – NICHT VERSENDEN` label.
It does not create a shop order, contact a payment provider, debit money, reduce
stock or consume a discount. Idempotent request keys and a one-minute global
simulation limit prevent repeated clicks from flooding the channel. This is
not a replacement for the merchant sandbox acceptance tests above.

Real notifications are enqueued atomically when provider-verified orders become
paid. Messages contain order ID, items/variants/quantities, totals, contact email,
shipping name/street/postcode/city/country, payment method and transaction ID.
Card numbers, CVC, expiry dates and provider credentials are never included.
Only allowlisted shipping fields are retained from provider responses. PayPal
approval additionally verifies order ID, purchase-unit count and the entire
required shipping address before initiating capture.

Use a restricted staff-only Discord channel. The operator must configure its
membership and review Discord data handling before enabling real sales. The
webhook token is a sending credential: rotate it in Discord if it is disclosed
outside trusted administration, then replace the Cloudflare Secret and redeploy.

Delivery uses `wait=true`, requires Discord's message ID, blocks mentions,
rejects non-Discord destinations and redirects, and times out after 10 seconds.
A 60-second atomic lease prevents concurrent sends; 429 backoff is respected.
Provider webhook retries retry an already-paid order's outstanding notification
without recapturing money or reserving stock again. Failures stay in the outbox;
the operator can retry them in the orders page after the backoff. A delayed
Discord message does not change the customer's paid order status.

There is no independent background scheduler. After provider retries stop,
check the pending list and retry manually. Delivery is **at least once**: if
Discord accepts a request but its response is lost, a retry can duplicate the
message. Always fulfil by unique order ID and verified paid live status, not
by the number of Discord messages. Never fulfil simulations or sandbox orders.
No automatic shipment, refund or customer confirmation email is implemented.
