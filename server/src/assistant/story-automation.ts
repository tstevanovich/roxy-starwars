import { Chat, Message, Run } from './models.ts';

// The normal chat worker executes these durable requests through the owner's
// ChatGPT plan. The engine restricts this run to drafting, never rendering.
export function createStoryQueue(chatgpt) {
  return async function queueStory(item) {
    const chat = await Chat.findOneAndUpdate(
      { workflowKey: item.requestId },
      {
        $setOnInsert: {
          title:
            item.kind === 'story-asset-brief'
              ? 'Workflow - Creative brief'
              : item.kind === 'story-outline'
                ? 'Workflow - episode outline'
                : item.kind === 'story-scene-plan'
                  ? 'Workflow - shot and sound plans'
                  : 'Workflow - first scene',
          context: {
            assetId: item.target.assetId,
            episodeId: item.target.episodeId,
            sceneId: item.target.sceneId
          },
          activeRun: null
        }
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    let run: import('mongoose').InferSchemaType<typeof Run.schema> & {
      _id?: import('mongoose').Types.ObjectId;
    } = await Run.findOne({ workflowKey: item.requestId }).lean();
    if (run) return run;
    const connection = await chatgpt.ready();
    run = (
      await Run.create({
        workflowKey: item.requestId,
        chatId: chat._id,
        status: 'preparing',
        provider: 'chatgpt-plan',
        ...connection,
        workflowDraft: item.draft
      })
    ).toObject();
    await Chat.updateOne({ _id: chat._id }, { $set: { activeRun: String(run._id) } });
    await Message.create({
      chatId: chat._id,
      role: 'user',
      requestId: item.requestId,
      runId: String(run._id),
      text:
        item.kind === 'story-asset-brief'
          ? `Automatic workflow: prepare the missing Creative brief for the EXISTING asset ${item.target.assetId}. Read selectedAsset, its source evidence, saved notes, reference package, linked episodes and finalized choices. Inspect saved source images when available. Use propose_production_plan with scope asset, this recordId, the complete brief in the top-level brief field and production copied exactly from the saved asset. Write the actual brief, not just advice or an explanation. Preserve source notes, package items, imported media and approved voice identity. Describe known source-grounded appearance, costume, performance and rendering direction; mark unverified details explicitly and do not invent canon. Use saved evidence first; explain any specific remaining evidence gap in the draft. Create one proposal for owner review and application. Do not create another asset, approve anything or generate media.`
          : item.kind === 'story-outline'
            ? 'Automatic workflow: source research is approved. Propose the episode outline from the saved verified source. Preserve all finalized choices. Create one outline proposal for owner review; do not render or approve anything.'
            : item.kind === 'story-scene-plan'
              ? `Automatic workflow: the script and linked references for scene ${item.target.sceneId} are approved. Prepare ONE shot and sound planning proposal for this EXISTING scene with propose_scene. Preserve the saved script, source notes, clip IDs/order/durations/dialogue/action/camera/effects and linked assets exactly. Only complete or repair clip.production planning fields and scene.soundPlan. Include clip.production.location, environment (space-exterior, surface-exterior or interior), and physicalConstraints independently for every shot. Orbital vacuum shots must not inherit a surface landing platform, cars, people, ground plane or hangar reveal. Surface shots need grounded terrain and the correct flying/parked state. If the shot plan is already approved, preserve every clip.production field as well. referenceMediaIds MUST use approved generated designs from linked assets finalChoice.mediaIds or approved required production image items. Raw gameplay/source evidence captures are research only and cannot be production references. Choose only designs of subjects/locations visible in each shot; do not insert offscreen characters. Include a structured soundPlan with notes, dialogueGainDb and layers: stable id, title, type ambience/effect, description, clipId, start, sourceStart, duration, gainDb, lowpassHz, loop. Use clip-relative seconds, every clip needs audible effects/ambience, no music. Leave assetId empty and sourceStart 0 for sounds not generated yet: each generated file is only layer.duration seconds long, so later offsets would trim it away. Do not invent sound files, longer uncreated beds or continuation offsets. Reuse approved sounds if available. Never render, approve, change finalized choices or rewrite the approved script. Explain that the owner applies this plan draft, then reviews Shot plan and Sound plan on the board.`
              : 'Automatic workflow: the episode outline is approved. Propose the first cinematic scene using its verified source, saved outline and finalized references. Include a scene script, shot plan and structured soundPlan, link the actual approved assets and source IDs, and create one scene proposal for owner review. Production referenceMediaIds must use approved generated design images, never raw gameplay captures. Do not render, approve, invent source decisions, or change finalized choices. If evidence is insufficient, explain the exact gap instead of inventing it.'
    });
    await Run.updateOne({ _id: run._id }, { $set: { status: 'queued' } });
    return { ...run, status: 'queued' };
  };
}
