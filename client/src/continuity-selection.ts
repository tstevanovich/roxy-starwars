type ContinuitySource = { sceneId: string; clipId: string };

// MUI autofill can supply a comma-separated string even for a multiple select.
// Encode the JSON tuple so commas inside IDs and tuples remain unambiguous.
export function continuityChoice(source: ContinuitySource): string {
  return encodeURIComponent(JSON.stringify([source.sceneId, source.clipId]));
}

export function continuitySelection(value: string | string[]): ContinuitySource[] {
  const choices = typeof value === 'string' ? value.split(',').filter(Boolean) : value;
  return choices.map((choice) => {
    const [sceneId, clipId]: [string, string] = JSON.parse(decodeURIComponent(choice));
    return { sceneId, clipId };
  });
}
