-- Apply once after 0007. Existing orders remain valid and keep their provider-confirmed address.
ALTER TABLE shop_orders ADD COLUMN checkout_details_json TEXT
  CHECK(checkout_details_json IS NULL OR json_valid(checkout_details_json));
