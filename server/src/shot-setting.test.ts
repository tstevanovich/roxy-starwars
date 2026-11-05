import { expect, test } from 'vitest';

import { ambiguousSceneLocation, shotLocation, shotPhysics } from './shot-setting.ts';

test('shot settings select the local location and physical environment instead of spanning unrelated sets', () => {
  expect(
    shotLocation({ location: 'Scene room' }, { production: { location: ' Local room ' } })
  ).toBe('Local room');
  expect(shotLocation({ location: 'Scene room' }, {})).toBe('Scene room');
  expect(shotPhysics({ production: { environment: 'space-exterior' } })).toContain(
    'orbital vacuum'
  );
  expect(shotPhysics({ production: { environment: 'surface-exterior' } })).toContain(
    'planetary surface'
  );
  expect(
    shotPhysics({ production: { environment: 'interior', physicalConstraints: 'Remain seated.' } })
  ).toContain('Remain seated.');
  expect(shotPhysics({ production: { physicalConstraints: 'Fixed platform.' } })).toBe(
    'Fixed platform.'
  );
  expect(shotPhysics({})).toBe('');
  expect(ambiguousSceneLocation({ location: 'Orbit and landing platform' })).toBe(true);
  expect(ambiguousSceneLocation({ location: 'Orbit' })).toBe(false);
  expect(ambiguousSceneLocation({})).toBe(false);
});
