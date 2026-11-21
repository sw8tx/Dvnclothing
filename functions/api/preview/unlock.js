import { failedPreview, grantPreview, matchesPreviewPassword, previewAttempts, previewCooldown,
  previewJson, readPreviewBody, safePreviewNext, validatePreviewRequest } from '../../_preview.js';

export async function onRequestPost({ request, env }) {
  const invalid = validatePreviewRequest(request, env);
  if (invalid) return invalid;
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return previewJson({ error: 'invalid_request' }, 415);
  }
  const state = await previewAttempts(request, env);
  const limited = previewCooldown(state);
  if (limited) return limited;
  const body = await readPreviewBody(request);
  if (!body) return previewJson({ error: 'invalid_request' }, 400);
  if (!await matchesPreviewPassword(body.password, env)) return failedPreview(state);
  return grantPreview(previewJson({ ok: true, redirect: safePreviewNext(body.next) }), env, state);
}
