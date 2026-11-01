import { createHash } from 'node:crypto';

import { StudioAsset, StudioMedia } from '../models/Studio.js';
import { workflowContext } from '../production-workflow.js';
import { projectKey } from '../project-context.js';
import { withProject } from '../projects.js';
import { saveGeneratedMedia } from '../studio-media.js';
import { fail, id } from '../studio-validation.js';
import { dialogueTurns, speakerAsset, speakerKey } from './dialogue.js';
import { Job, Proposal } from './models.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function voiceDirection(speaker, assets) {
  const voice = speakerAsset(speaker, assets);
  if (voice?.production?.voiceDescription?.trim())
    return voice.production.voiceDescription.trim().slice(0, 1000);
  const character =
    speakerAsset(speaker, assets, 'character') ?? speakerAsset(speaker, assets, 'droid');
  if (character?.production?.voiceDescription?.trim())
    return character.production.voiceDescription.trim().slice(0, 1000);
  if (
    voice?.brief &&
    (!voice.seedKey?.startsWith('workflow-voice-') ||
      (voice.production?.voiceDescription && voice.production.voiceDescription !== voice.brief))
  )
    return voice.brief.slice(0, 1000);
  const direction = [character?.brief, character?.notes]
    .filter(Boolean)
    .join('\n')
    .split(/[.!?\n]/)
    .filter(
      (sentence) =>
        /\b(voice|accent|diction|baritone|vocal|raspy|speaking)\b/i.test(sentence) &&
        !/\b(portrait|costume|turnaround|source frames|https?)\b/i.test(sentence)
    )
    .join('. ')
    .slice(0, 600);
  return `An original cinematic speaking voice for an adult fictional character. Natural clear speech, expressive delivery, crisp diction and a clean studio recording. No sound effects or music. ${direction || 'A distinctive natural character performance.'}`.slice(
    0,
    1000
  );
}
export function currentVoiceAuditions(asset, description) {
  return (asset?.candidates ?? []).filter(
    (candidate) =>
      !candidate.archived &&
      candidate.mediaIds?.length &&
      (!candidate.generatedVoiceId ||
        (candidate.voiceDescription ?? candidate.description)?.trim() === description.trim())
  );
}
export function voiceRevisionFields(asset, production) {
  const description = production.voiceDescription?.trim() || asset.brief;
  const candidates = (asset.candidates ?? []).map((candidate) =>
    candidate.generatedVoiceId &&
    candidate.id !== asset.finalChoice?.id &&
    (candidate.voiceDescription ?? candidate.description)?.trim() !== description?.trim()
      ? { ...candidate, archived: true }
      : candidate
  );
  return {
    production: { ...production, voiceDescription: description, managed: false },
    brief: description,
    candidates,
    reviewStatus: asset.finalChoice
      ? asset.reviewStatus
      : currentVoiceAuditions({ candidates }, description).length
        ? 'pending-choice'
        : 'development'
  };
}
export function createVoiceProduction({ mediaDirectory, fetcher = fetch }) {
  async function state(target, speaker) {
    const context = await workflowContext();
    if (target.assetId) {
      const voice = context.assets.find(
        (asset) =>
          String(asset._id) === id(target.assetId) && asset.kind === 'voice' && !asset.archived
      );
      if (!voice?.production?.voiceDescription?.trim())
        fail('Save the voice generation prompt first.');
      const description = voice.production.voiceDescription.trim();
      return {
        description,
        fingerprint: digest({ assetId: String(voice._id), description }),
        assets: context.assets,
        voice
      };
    }
    const t = { scope: 'scene', recordId: target.episodeId, sceneId: target.sceneId };
    const { scene } = context.locate(t);
    if (
      context.evaluate({ scope: 'episode', recordId: target.episodeId }, 'outline').status !==
      'approved'
    )
      fail(
        'Approve the updated episode outline before starting new production. Existing scene approvals remain saved.'
      );
    if (
      !scene.clips.some(
        (clip) =>
          clip.dialogue?.trim() &&
          dialogueTurns(clip.dialogue).some(
            (turn) => speakerKey(turn.speaker) === speakerKey(speaker)
          )
      )
    )
      fail('This voice is no longer required by the saved scene.');
    const gates = ['script', 'shot-plan', 'references'].map((stage) => context.evaluate(t, stage));
    if (gates.some((row) => row.status !== 'approved'))
      fail(
        'Approve the scene script, shot plan and references before generating its voice auditions.'
      );
    const description = voiceDirection(speaker, context.assets);
    const voice = speakerAsset(speaker, context.assets);
    if (voice && (await Proposal.exists({ assetId: String(voice._id), status: 'pending' })))
      fail('Apply the current voice-directions draft before generating auditions.');
    return {
      description,
      fingerprint: digest({ gates: gates.map((row) => row.fingerprint), description }),
      assets: context.assets
    };
  }
  async function queue({ target, speaker, requestId, chatId }) {
    const existing = await Job.findOne({ requestId }).lean();
    if (existing) return existing;
    if (!process.env.ELEVENLABS_API_KEY)
      fail('Configure the server ElevenLabs key before generating voice auditions.');
    const current = await state(target, speaker);
    let asset = current.voice ?? speakerAsset(speaker, current.assets);
    if (
      asset &&
      (await Job.exists({
        kind: 'voice',
        resultAssetId: String(asset._id),
        status: {
          $in: ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain']
        }
      }))
    )
      fail('This voice already has a generation request in progress.');
    if (
      !target.assetId &&
      (asset?.finalChoice || currentVoiceAuditions(asset, current.description).length)
    )
      fail(`Review the existing ${speaker} voice before requesting another audition.`);
    if (!asset)
      asset = await StudioAsset.findOneAndUpdate(
        { seedKey: `workflow-voice-${projectKey()}-${speakerKey(speaker)}` },
        {
          $setOnInsert: {
            name: `${speaker} - voice auditions`,
            aliases: [speaker],
            kind: 'voice',
            brief: current.description,
            production: { voiceDescription: current.description },
            candidates: [],
            reviewStatus: 'development'
          }
        },
        { upsert: true, returnDocument: 'after' }
      ).lean();
    else {
      const snapshot = { ...asset };
      delete snapshot.history;
      const updated = await StudioAsset.updateOne(
        { _id: asset._id, revision: asset.revision },
        {
          $set: voiceRevisionFields(asset, {
            ...asset.production,
            voiceDescription: current.description
          }),
          $inc: { revision: 1 },
          $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
        }
      );
      if (!updated.modifiedCount)
        fail('The voice changed while preparing auditions. Refresh its directions.', 409);
    }
    const appliedDraft = chatId
      ? null
      : await Proposal.findOne({
          assetId: String(asset._id),
          status: 'applied',
          'production.voiceDescription': current.description
        })
          .sort({ createdAt: -1 })
          .select('chatId')
          .lean();
    return (
      await Job.create({
        chatId: chatId || appliedDraft?.chatId,
        kind: 'voice',
        requestId,
        target,
        title: `Voice auditions · ${speaker}`,
        status: 'queued',
        resultAssetId: String(asset._id),
        payload: { speaker, assetId: String(asset._id), description: current.description },
        snapshot: { fingerprint: current.fingerprint }
      })
    ).toObject();
  }
  async function processJob(job) {
    await withProject(job.projectKey, async () => {
      if (
        !(
          await Job.updateOne({ _id: job._id, status: 'queued' }, { $set: { status: 'preparing' } })
        ).modifiedCount
      )
        return;
      try {
        const current = await state(job.target, job.payload.speaker);
        if (current.fingerprint !== job.snapshot.fingerprint)
          fail('The approved voice directions changed before generation.');
        const asset = await StudioAsset.findById(job.payload.assetId).lean();
        if (!asset || asset.archived || (asset.finalChoice && !job.target.assetId))
          fail('The voice was removed or already finalized.');
        await Job.updateOne({ _id: job._id }, { $set: { status: 'submitting' } });
        const response = await fetcher(
          'https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128',
          {
            method: 'POST',
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model_id: 'eleven_ttv_v3',
              voice_description: job.payload.description,
              auto_generate_text: true,
              seed: parseInt(digest(speakerKey(job.payload.speaker)).slice(0, 8), 16) % 2147483647
            }),
            signal: AbortSignal.timeout(120000)
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const reason = String(
            body.detail?.message ||
              body.message ||
              body.detail?.status ||
              'Check ElevenLabs permissions and credits.'
          ).slice(0, 1000);
          throw Object.assign(
            new Error(`Voice audition generation failed (${response.status}): ${reason}`),
            { status: 502, rejected: true }
          );
        }
        const result = await response.json();
        if (!result.previews?.length) fail('ElevenLabs returned no voice auditions.');
        // Save the provider result before importing so a restart never repeats a paid design request.
        await Job.updateOne({ _id: job._id }, { $set: { status: 'importing', receipt: result } });
        await importPreviews({ ...job, receipt: result });
      } catch (error) {
        const current = await Job.findById(job._id).lean();
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              status:
                current.status === 'submitting' && !error.rejected
                  ? 'uncertain'
                  : current.status === 'importing'
                    ? 'importing'
                    : 'failed',
              error: error.status
                ? error.message
                : 'Voice generation connection failed. Check provider history before requesting another audition.'
            }
          }
        );
      }
    });
  }
  async function importPreviews(job) {
    const mediaIds = [];
    for (const [index, preview] of job.receipt.previews.entries()) {
      const candidateId = `voice-${job._id}-${index}`;
      const asset = await StudioAsset.findById(job.payload.assetId).lean();
      const old = asset?.candidates?.find((candidate) => candidate.id === candidateId);
      if (!asset || asset.archived) fail('The voice audition asset was removed.');
      if (old) {
        mediaIds.push(...old.mediaIds.map(String));
        continue;
      }
      if (!preview.generated_voice_id || !preview.audio_base_64)
        fail('ElevenLabs returned an incomplete audition.');
      const media = await saveGeneratedMedia(
        mediaDirectory,
        Buffer.from(preview.audio_base_64, 'base64'),
        `voice-${job._id}-${index}.mp3`,
        {
          productionJobId: String(job._id),
          voiceDesign: { generatedVoiceId: preview.generated_voice_id }
        }
      );
      mediaIds.push(String(media._id));
      const currentDescription =
        asset.production?.voiceDescription?.trim() || voiceDirection(job.payload.speaker, [asset]);
      const stale = currentDescription !== job.payload.description;
      await StudioAsset.updateOne(
        { _id: asset._id, 'candidates.id': { $ne: candidateId } },
        {
          $push: {
            candidates: {
              id: candidateId,
              title: `${job.payload.speaker} audition ${index + 1}`,
              description: job.payload.description,
              voiceDescription: job.payload.description,
              mediaIds: [media._id],
              generatedVoiceId: preview.generated_voice_id,
              voiceModel: 'eleven_v3',
              archived: stale
            }
          },
          $set: {
            reviewStatus:
              !stale || currentVoiceAuditions(asset, currentDescription).length
                ? 'pending-choice'
                : 'development'
          },
          $inc: { revision: 1 }
        }
      );
    }
    await Job.updateOne(
      { _id: job._id },
      {
        $set: { status: 'ready', resultMediaIds: mediaIds, error: '' },
        $unset: { 'receipt.previews': '' }
      }
    );
  }
  async function finalize(asset, candidate) {
    if (!candidate.generatedVoiceId || candidate.voiceId) return candidate;
    if (
      (candidate.voiceDescription ?? candidate.description)?.trim() !==
      (asset.production?.voiceDescription || asset.brief)?.trim()
    )
      fail(
        'This audition belongs to earlier voice directions. Review an audition generated from the current directions.'
      );
    const media = await StudioMedia.findById(candidate.mediaIds[0]).lean();
    if (media?.voiceDesign?.generatedVoiceId !== candidate.generatedVoiceId)
      fail('This preview does not belong to the selected voice audition.');
    let voiceId = media?.voiceDesign?.savedVoiceId;
    if (!voiceId) {
      const response = await fetcher('https://api.elevenlabs.io/v1/text-to-voice', {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          voice_name: asset.name.slice(0, 100),
          voice_description: (candidate.voiceDescription ?? candidate.description).slice(0, 1000),
          generated_voice_id: candidate.generatedVoiceId
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok)
        fail(`Saving the chosen ElevenLabs voice failed (${response.status}).`, 502);
      voiceId = (await response.json()).voice_id;
      if (!voiceId) fail('ElevenLabs did not return the saved voice ID.');
      await StudioMedia.updateOne(
        { _id: media._id },
        { $set: { 'voiceDesign.savedVoiceId': voiceId } }
      );
    }
    return { ...candidate, voiceId, voiceModel: 'eleven_v3' };
  }
  return { queue, processJob, importPreviews, finalize };
}
