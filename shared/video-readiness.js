// Omit absent fields to keep installing the feature from invalidating reviews.
export function motionInput(production = {}) {
  return production.startState || production.endState || production.allowedMotion
    ? {
        motion: {
          startState: production.startState || '',
          endState: production.endState || '',
          allowedMotion: production.allowedMotion || ''
        }
      }
    : {};
}
