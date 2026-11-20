import { noStore } from '../auth/_lib.js';

// Older storefront versions may still offer delivery of a discount code.
export function onRequestPost() {
  return noStore(Response.json({ error: 'bonus_email_discontinued' }, { status: 410 }));
}
