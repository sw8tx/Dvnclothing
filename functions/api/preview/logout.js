import { clearPreview, validatePreviewRequest } from '../../_preview.js';
import { noStore } from '../auth/_lib.js';

export async function onRequestPost({ request, env }) {
  const invalid = validatePreviewRequest(request, env);
  if (invalid) return invalid;
  return clearPreview(noStore(new Response(null, { status: 204 })));
}
