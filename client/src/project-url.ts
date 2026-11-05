export const currentProjectKey = () =>
  new URLSearchParams(window.location.search).get('project') || 'imperial-smuggler';
export function studioUrl(url: string) {
  const key = currentProjectKey();
  return key === 'imperial-smuggler'
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}project=${encodeURIComponent(key)}`;
}
export const projectHeaders = () =>
  currentProjectKey() === 'imperial-smuggler' ? {} : { 'X-Studio-Project': currentProjectKey() };
