import { clearCookie, noStore, origin } from './_lib.js';

export async function onRequestPost({ request }) {
  const site = origin(request);
  if (!site || request.headers.get('Origin') !== site) return noStore(new Response('Invalid origin', { status: 403 }));
  const response = noStore(new Response(null, { status: 204 }));
  clearCookie(response, '__Host-dvn-session');
  return response;
}
