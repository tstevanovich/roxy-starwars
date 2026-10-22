import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request, setCsrfToken, uploadMedia } from './api.js';

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
  const file = new File(['test'], 'test.png', { type: 'image/png' });
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
  fetch.mockResolvedValue({ status: 401, ok: false, json: async () => ({ message: 'Sign in' }) });
  await expect(request('/studio')).rejects.toThrow('Sign in');
  expect(expired).toHaveBeenCalledTimes(1);
  await expect(
    request('/auth/login', { method: 'POST', body: { password: 'bad' } })
  ).rejects.toThrow('Sign in');
  expect(expired).toHaveBeenCalledTimes(1);
  window.removeEventListener('studio:sign-in-required', expired);
});
