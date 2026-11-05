import type { MediaFile, StudioData } from '../../shared/types.ts';
import { projectHeaders } from './project-url.ts';
import { notifyStudioChange, productionMutation } from './studio-events.ts';
export type RequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
};
let csrfToken = '';
export function setCsrfToken(value?: string) {
  csrfToken = value || '';
}
function securityHeaders(method?: string): Record<string, string> {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase()) && csrfToken
    ? { 'X-CSRF-Token': csrfToken }
    : {};
}
function requireSignIn(response: Response, path: string) {
  if (response.status === 401 && !path.startsWith('/auth/'))
    window.dispatchEvent(new Event('studio:sign-in-required'));
}
export function request(path: '/studio', options?: RequestOptions): Promise<StudioData>;
export function request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
export function request(path: string, options?: RequestOptions): Promise<unknown>;
export async function request<T = unknown>(
  path: string,
  { body, ...options }: RequestOptions = {}
): Promise<T> {
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
  if (response.status === 204) {
    if (productionMutation(path, options.method)) notifyStudioChange();
    return null as T;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = Object.assign(
      new Error(data?.message ?? `Request failed (${response.status}).`),
      { status: response.status }
    );
    throw error;
  }
  if (!data) throw new Error('The API returned an unexpected response.');
  if (productionMutation(path, options.method)) notifyStudioChange();
  return data as T;
}

export async function uploadMedia(file: File): Promise<MediaFile> {
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
