export const studioChangeEvent = 'studio:changed';
export const studioChangeKey = 'roxy-studio-change';

export function notifyStudioChange() {
  window.dispatchEvent(new Event(studioChangeEvent));
  try {
    localStorage.setItem(studioChangeKey, `${Date.now()}-${Math.random()}`);
  } catch {
    /* Same-tab refresh and polling still work when storage is unavailable. */
  }
}

export function productionMutation(path, method: string) {
  return (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase()) &&
    ((/^\/studio\/(assets|episodes|music|workflow)(\/|$)/.test(path) &&
      path !== '/studio/workflow/board') ||
      /^\/studio\/assistant\/proposals\//.test(path))
  );
}
