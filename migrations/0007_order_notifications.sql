-- Durable outbox: order state and notification intent commit together.
CREATE TABLE IF NOT EXISTS shop_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT UNIQUE REFERENCES shop_orders(id),
  simulation_json TEXT CHECK(simulation_json IS NULL OR json_valid(simulation_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  sent_at INTEGER,
  CHECK((order_id IS NOT NULL AND simulation_json IS NULL) OR (order_id IS NULL AND simulation_json IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS shop_notifications_due ON shop_notifications(status,retry_at,created_at);
CREATE INDEX IF NOT EXISTS shop_notifications_simulations ON shop_notifications(created_at) WHERE order_id IS NULL;
CREATE TRIGGER IF NOT EXISTS shop_paid_notification AFTER UPDATE OF status ON shop_orders
WHEN NEW.status='paid' AND OLD.status<>'paid' BEGIN
  INSERT OR IGNORE INTO shop_notifications(id,order_id) VALUES(NEW.id,NEW.id);
END;
-- Existing paid orders are included without duplicating an earlier notification.
INSERT OR IGNORE INTO shop_notifications(id,order_id) SELECT id,id FROM shop_orders WHERE status='paid';
