// Omit absent fields to keep installing the feature from invalidating reviews.
import type { ProductionSettings } from './types.ts';
export function motionInput(production: ProductionSettings = {}) {
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
