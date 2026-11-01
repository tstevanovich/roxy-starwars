import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dialogueCast, dialogueTurns } from '../src/assistant/dialogue.js';
import { speakerVoice } from '../src/assistant/production.js';
import {
  currentVoiceAuditions,
  voiceDirection,
  voiceRevisionFields
} from '../src/assistant/voice-production.js';
import { assetInput } from '../src/studio-validation.js';

const voice = {
  name: 'Harkun voice',
  kind: 'voice',
  finalChoice: { voiceId: 'harkun', voiceModel: 'eleven_v3' }
};

test('repeated lines by the same speaker are combined without reading the speaker labels', () => {
  const result = speakerVoice(
    { dialogue: 'HARKUN: First line.\nHarkun: Second line.\nHARKUN: Third line.' },
    [voice]
  );
  assert.equal(result.voice, voice);
  assert.equal(result.spokenText, 'First line.\nSecond line.\nThird line.');
});

test('different speakers are rejected regardless of label capitalization', () => {
  for (const secondSpeaker of ['ROXY', 'Roxy', 'roxy']) {
    assert.throws(
      () => speakerVoice({ dialogue: `HARKUN: First line.\n${secondSpeaker}: Reply.` }, [voice]),
      /one speaker per clip/
    );
  }
});

test('unlabeled continuation lines are retained and a matching finalized voice is required', () => {
  const dialogue = 'HARKUN: First line.\nAn unlabeled continuation.';
  assert.equal(
    speakerVoice({ dialogue }, [voice]).spokenText,
    'First line.\nAn unlabeled continuation.'
  );
  assert.throws(() => speakerVoice({ dialogue }, []), /Finalize this speaker/);
});

test('multi-speaker dialogue retains ordered turns and uses each approved voice', () => {
  const roxy = {
    name: 'Roxy voice',
    kind: 'voice',
    finalChoice: { voiceId: 'roxy', voiceModel: 'eleven_v3' }
  };
  const cast = dialogueCast({ dialogue: 'HARKUN: Leave.\nRoxy: Gladly.\nHarkun: Now.' }, [
    voice,
    roxy
  ]);
  assert.deepEqual(cast.inputs, [
    { text: 'Leave.', voice_id: 'harkun' },
    { text: 'Gladly.', voice_id: 'roxy' },
    { text: 'Now.', voice_id: 'harkun' }
  ]);
  assert.throws(
    () => dialogueCast({ dialogue: 'HARKUN: Leave.\nROXY: Gladly.' }, [voice]),
    /Voice auditions need approval for: ROXY/
  );
  assert.throws(() => dialogueTurns('No speaker label.'), /Label dialogue/);
});

test('automatic voice directions exclude visual instructions and use the saved voice description', () => {
  const description = voiceDirection('Harkun', [
    {
      name: 'Harkun character',
      kind: 'character',
      brief:
        'Inspect source frames before drawing the costume. Full-body turnaround, heads and feet visible. A low, rough voice with crisp diction.'
    }
  ]);
  assert.match(description, /low, rough voice/);
  assert.doesNotMatch(description, /costume|turnaround|source frames/);
  assert.equal(
    voiceDirection('Harkun', [
      {
        name: 'Harkun voice',
        kind: 'voice',
        seedKey: 'workflow-voice-test-harkun',
        brief: 'My revised voice direction.',
        production: { voiceDescription: 'Original prepared direction.' }
      }
    ]),
    'Original prepared direction.'
  );
  const edited = assetInput({
    name: 'Harkun voice',
    kind: 'voice',
    brief: 'My edited voice direction.',
    production: { voiceDescription: 'Original prepared direction.' }
  });
  assert.equal(
    voiceDirection('Harkun', [{ ...edited, seedKey: 'workflow-voice-test-harkun' }]),
    'Original prepared direction.'
  );
});

test('an applied female voice correction supersedes generic auditions while option feedback keeps the current generation', () => {
  const description = 'Adult female with a slight English accent.';
  const asset = {
    kind: 'voice',
    name: 'Kory',
    brief: 'Generic old brief.',
    production: { voiceDescription: description },
    candidates: [
      {
        id: 'old',
        generatedVoiceId: 'preview-old',
        description: 'Generic old brief.',
        mediaIds: ['audio-old']
      }
    ]
  };
  assert.equal(voiceDirection('Kory', [asset]), description);
  assert.equal(currentVoiceAuditions(asset, description).length, 0);
  const revised = voiceRevisionFields(asset, asset.production);
  assert.equal(revised.brief, description);
  assert.equal(revised.candidates[0].archived, true);
  assert.deepEqual(revised.candidates[0].mediaIds, ['audio-old']);
  assert.equal(
    currentVoiceAuditions(
      {
        candidates: [
          {
            id: 'current',
            generatedVoiceId: 'preview-current',
            voiceDescription: description,
            description: 'Owner feedback: audition one sounds too breathy.',
            mediaIds: ['audio-current']
          }
        ]
      },
      description
    ).length,
    1
  );
});
