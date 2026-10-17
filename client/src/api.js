export async function request(path, { body, ...options } = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? `Request failed (${response.status}).`);
  }
  if (!data) throw new Error('The API returned an unexpected response.');
  return data;
}
