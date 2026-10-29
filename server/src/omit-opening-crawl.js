// The owner removed the optional crawl. Retain the gameplay arrival/trials and
// all scene media; this only removes intro instructions from the active plan.
export function omitOpeningCrawl(episode) {
  const next = structuredClone(episode);
  next.sourceReferences = next.sourceReferences.filter((r) => r.id !== 'opening-crawl');
  next.notes = (next.notes ?? '').replace(
    'Begin with the Sith Inquisitor opening crawl assembled in CapCut.',
    'Begin directly with Arrival at Korriban. No opening crawl.'
  );
  next.production.sourceNotes = (next.production.sourceNotes ?? '')
    .replaceAll('no generated music', 'no music in generated video soundtracks')
    .replace(/^14:00[^\n]*\n/gm, '')
    .replace(', plus the separate crawl', '')
    .replace('crawl -> Arrival at Korriban', 'Arrival at Korriban');
  next.production.outline = (next.production.outline ?? '')
    .replaceAll('no generated music', 'no music in generated video soundtracks')
    .replace('Separate CapCut crawl -> Arrival at Korriban', 'Arrival at Korriban')
    .replace(/INTRO — OPENING CRAWL\n[^]*?(?=1 — ARRIVAL AT KORRIBAN)/, '')
    .replace(
      'CapCut handles final editing, crawl and any music.',
      'CapCut handles final editing and the separately approved original background music. No opening crawl.'
    )
    .replace('Exact crawl wording; ', '');
  next.production.sourceNotes +=
    '\n\nOwner production decision (2026-10-28): omit the opening crawl. Begin directly with Arrival at Korriban. Background music is a separate original ElevenLabs cue, reviewed in the app and exported for CapCut; generated video soundtracks still contain effects/dialogue only.';
  return next;
}
