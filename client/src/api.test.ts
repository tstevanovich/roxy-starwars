import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request, setCsrfToken, uploadMedia } from './api.ts';
import { studioChangeEvent, studioChangeKey } from './studio-events.ts';

beforeEach(() => {
  setCsrfToken('csrf-test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ media: { _id: 'media1' } })
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken('');
});
test('API mutations and media uploads send cookie credentials and the CSRF token', async () => {
  await request('/studio/assets', { method: 'POST', body: { name: 'Test' } });
  expect(fetch).toHaveBeenCalledWith(
    '/api/studio/assets',
    expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-test' })
    })
  );
  const file = new File(['test'], 'test.png', { type: 'image/png' as const });
  await uploadMedia(file);
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/studio/media',
    expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-test', 'X-File-Name': 'test.png' })
    })
  );
});
test('unauthenticated studio requests notify the login gate; auth errors stay within the form', async () => {
  const expired = vi.fn();
  window.addEventListener('studio:sign-in-required', expired);
  vi.mocked(fetch).mockImplementation(
    async () => new Response(JSON.stringify({ message: 'Sign in' }), { status: 401 })
  );
  await expect(request('/studio')).rejects.toThrow('Sign in');
  expect(expired).toHaveBeenCalledTimes(1);
  await expect(
    request('/auth/login', { method: 'POST', body: { password: 'bad' } })
  ).rejects.toThrow('Sign in');
  expect(expired).toHaveBeenCalledTimes(1);
  window.removeEventListener('studio:sign-in-required', expired);
});

test('applying production-chat drafts notifies this window and other tabs without notifying on board reads or failed writes', async () => {
  const changed = vi.fn();
  window.addEventListener(studioChangeEvent, changed);
  try {
    await request('/studio/workflow/board', { method: 'POST', body: {} });
    expect(changed).not.toHaveBeenCalled();
    await request('/studio/assistant/proposals/draft/apply', { method: 'POST', body: {} });
    expect(changed).toHaveBeenCalledOnce();
    expect(localStorage.getItem(studioChangeKey)).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Changed inputs' }), { status: 409 })
    );
    await expect(
      request('/studio/workflow/shot/approve', { method: 'POST', body: {} })
    ).rejects.toThrow('Changed inputs');
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(studioChangeEvent, changed);
  }
});

test('empty successful mutations notify editors, while empty reads do not', async () => {
  const changed = vi.fn();
  window.addEventListener(studioChangeEvent, changed);
  vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 204 }));
  try {
    expect(await request('/studio/assets/old', { method: 'DELETE' })).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
    expect(await request('/auth/session')).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(studioChangeEvent, changed);
  }
});

test('malformed and empty API responses produce useful errors with the HTTP status', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid JSON', { status: 502 }));
  await expect(request('/studio')).rejects.toMatchObject({
    message: 'Request failed (502).',
    status: 502
  });
  vi.mocked(fetch).mockResolvedValueOnce(new Response('null'));
  await expect(request('/studio')).rejects.toThrow('The API returned an unexpected response.');
});

test('upload errors preserve the provider message and fall back safely for non-JSON errors', async () => {
  const file = new File(['voice'], 'voice audition.wav');
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ message: 'File too large' }), { status: 413 })
  );
  await expect(uploadMedia(file)).rejects.toThrow('File too large');
  vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid JSON', { status: 502 }));
  await expect(uploadMedia(file)).rejects.toThrow(
    'The upload failed. Your original file is unchanged.'
  );
});
