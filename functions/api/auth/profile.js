import { noStore, origin } from './_lib.js';
import { validAvatar } from './_avatar.js';
import { identity, profileConfigured, saveProfile } from './_profile.js';
import { CheckoutError, readJson } from '../checkout/_lib.js';

const error = (code, status) => noStore(Response.json({ error: code }, { status }));

export async function onRequestPost({ request, env }) {
  const site = origin(request);
  if (!site || new URL(request.url).origin !== site || request.headers.get('Origin') !== site) {
    return error('invalid_origin', 403);
  }
  const user = await identity(request, env);
  if (!user) return error('unauthenticated', 401);
  if (!profileConfigured(env)) return error('profile_unavailable', 503);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error('invalid_request', 415);
  }

  let body;
  try {
    body = await readJson(request, { limit: 180000 });
  } catch (failure) {
    return failure instanceof CheckoutError ? error(failure.code, failure.status) : error('invalid_request', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
      Object.keys(body).some(key => key !== 'name' && key !== 'avatar')) return error('invalid_request', 400);
  if ('name' in body) {
    if (typeof body.name !== 'string') return error('invalid_name', 400);
    body.name = body.name.trim();
    if (!body.name || [...body.name].length > 64 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(body.name)) {
      return error('invalid_name', 400);
    }
  }
  if ('avatar' in body && !validAvatar(body.avatar)) return error('invalid_avatar', 400);
  try {
    return noStore(Response.json({ user: await saveProfile(user, body, env) }));
  } catch {
    return error('profile_unavailable', 503);
  }
}
