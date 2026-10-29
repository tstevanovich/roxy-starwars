import { projectHeaders } from './project-url.js';
let csrfToken = '';
export function setCsrfToken(value) {
  csrfToken = value || '';
}
function securityHeaders(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase()) && csrfToken
    ? { 'X-CSRF-Token': csrfToken }
    : {};
}
function requireSignIn(response, path) {
  if (response.status === 401 && !path.startsWith('/auth/'))
    window.dispatchEvent(new Event('studio:sign-in-required'));
}
export async function request(path, { body, ...options } = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(path.startsWith('/studio') ? projectHeaders() : {}),
      ...securityHeaders(options.method),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  requireSignIn(response, path);
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message ?? `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!data) throw new Error('The API returned an unexpected response.');
  return data;
}

export async function uploadMedia(file) {
  const response = await fetch('/api/studio/media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...projectHeaders(),
      ...securityHeaders('POST'),
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name)
    },
    body: file
  });
  requireSignIn(response, '/studio/media');
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.message ?? 'The upload failed. Your original file is unchanged.');
  return data.media;
}
