-- Apply once to DVN_AUTH_DB after 0001–0005. Reapplying never replenishes stock.
CREATE TABLE IF NOT EXISTS account_carts (
  owner_id TEXT PRIMARY KEY NOT NULL,
  items_json TEXT NOT NULL CHECK(json_valid(items_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE IF NOT EXISTS shop_inventory (
  product_id TEXT NOT NULL,
  size TEXT NOT NULL CHECK(size IN ('S','M','L')),
  available INTEGER NOT NULL CHECK(available >= 0),
  PRIMARY KEY(product_id,size)
);
INSERT OR IGNORE INTO shop_inventory(product_id,size,available)
SELECT p.value,s.value,5
FROM json_each('["blue-mirage-black","blue-mirage-white","define-your-vision","blue-sunshine","purple-sunshine"]') p,
json_each('["S","M","L"]') s;

CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  email TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('card','paypal')),
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','capturing','paid','cancelled')),
  request_hash TEXT NOT NULL,
  items_json TEXT NOT NULL CHECK(json_valid(items_json)),
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents>=0 AND discount_cents<subtotal_cents),
  discount_code TEXT COLLATE NOCASE,
  shipping_cents INTEGER NOT NULL CHECK(shipping_cents>=0),
  total_cents INTEGER NOT NULL CHECK(total_cents=subtotal_cents-discount_cents+shipping_cents),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
  provider_id TEXT UNIQUE,
  payment_id TEXT UNIQUE,
  approval_url TEXT,
  fulfilment_json TEXT CHECK(fulfilment_json IS NULL OR json_valid(fulfilment_json)),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
  paid_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_one_pending_customer ON shop_orders(customer_key,mode)
WHERE status IN ('creating','pending','capturing');
CREATE UNIQUE INDEX IF NOT EXISTS shop_one_welcome_redemption ON shop_orders(discount_code,mode)
WHERE discount_code IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS shop_orders_owner ON shop_orders(owner_id,created_at);
CREATE INDEX IF NOT EXISTS shop_orders_customer ON shop_orders(customer_key,mode,status);
CREATE INDEX IF NOT EXISTS shop_orders_expiry ON shop_orders(method,status,created_at);

-- Reservation and eligibility are checked inside the same write transaction.
CREATE TRIGGER IF NOT EXISTS shop_reserve_stock BEFORE INSERT ON shop_orders BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM shop_orders WHERE mode=NEW.mode AND status IN ('creating','pending','capturing')
    AND (owner_id=NEW.owner_id OR owner_id IN (SELECT google_id FROM account_links WHERE email_id=NEW.owner_id
      UNION SELECT email_id FROM account_links WHERE google_id=NEW.owner_id))) THEN RAISE(ABORT,'pending_order') END;
  SELECT CASE WHEN NEW.discount_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM welcome_bonuses WHERE code=NEW.discount_code AND retired=0
      AND (owner_id=NEW.owner_id OR owner_id IN (SELECT google_id FROM account_links WHERE email_id=NEW.owner_id
        UNION SELECT email_id FROM account_links WHERE google_id=NEW.owner_id))
  ) THEN RAISE(ABORT,'discount_unavailable') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.items_json) line
    LEFT JOIN shop_inventory stock ON stock.product_id=json_extract(line.value,'$.productId')
      AND stock.size=json_extract(line.value,'$.size')
    WHERE stock.available IS NULL OR stock.available<json_extract(line.value,'$.quantity')
  ) THEN RAISE(ABORT,'stock_unavailable') END;
  SELECT CASE WHEN NEW.discount_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM shop_orders WHERE mode=NEW.mode AND status='paid' AND
    (customer_key=NEW.customer_key OR owner_id=NEW.owner_id OR owner_id IN (
      SELECT google_id FROM account_links WHERE email_id=NEW.owner_id
      UNION SELECT email_id FROM account_links WHERE google_id=NEW.owner_id
    ))
  ) THEN RAISE(ABORT,'discount_unavailable') END;
  UPDATE shop_inventory SET available=available-(
    SELECT sum(json_extract(line.value,'$.quantity')) FROM json_each(NEW.items_json) line
    WHERE json_extract(line.value,'$.productId')=product_id AND json_extract(line.value,'$.size')=size
  ) WHERE EXISTS (SELECT 1 FROM json_each(NEW.items_json) line
    WHERE json_extract(line.value,'$.productId')=product_id AND json_extract(line.value,'$.size')=size);
END;
-- Clear only an unchanged account bag. A newer selection on another device survives payment.
CREATE TRIGGER IF NOT EXISTS shop_paid_cart AFTER UPDATE OF status ON shop_orders
WHEN NEW.status='paid' AND OLD.status<>'paid' BEGIN
  UPDATE account_carts SET items_json='[]',version=version+1,updated_at=unixepoch()
  WHERE owner_id IN (NEW.owner_id,(SELECT google_id FROM account_links WHERE email_id=NEW.owner_id),
    (SELECT email_id FROM account_links WHERE google_id=NEW.owner_id))
  AND json_array_length(items_json)=json_array_length(NEW.items_json)
  AND NOT EXISTS (SELECT 1 FROM json_each(items_json) c WHERE NOT EXISTS (
    SELECT 1 FROM json_each(NEW.items_json) p
    WHERE json_extract(c.value,'$.productId')=json_extract(p.value,'$.productId')
      AND json_extract(c.value,'$.size')=json_extract(p.value,'$.size')
      AND json_extract(c.value,'$.quantity')=json_extract(p.value,'$.quantity')));
END;
CREATE TRIGGER IF NOT EXISTS shop_release_stock AFTER UPDATE OF status ON shop_orders
WHEN NEW.status='cancelled' AND OLD.status IN ('creating','pending') BEGIN
  UPDATE shop_inventory SET available=available+(
    SELECT sum(json_extract(line.value,'$.quantity')) FROM json_each(OLD.items_json) line
    WHERE json_extract(line.value,'$.productId')=product_id AND json_extract(line.value,'$.size')=size
  ) WHERE EXISTS (SELECT 1 FROM json_each(OLD.items_json) line
    WHERE json_extract(line.value,'$.productId')=product_id AND json_extract(line.value,'$.size')=size);
END;
