# Roxy Kane studio guide

The local studio is the place to compare creative directions, keep original media, finalize reusable assets, and prepare episode scenes for production. Start it with `npm.cmd run dev` from the repository root, then open <http://127.0.0.1:5173>.

Sign in with your owner account before opening records or media. The same saved workspace is available through the phone layout and the private HTTPS tunnel. Read [remote access and account setup](REMOTE-ACCESS.md) for the one-time setup link, startup commands and password recovery. On a phone, the upper-left menu opens navigation; an episode's **Jump to scene** selector avoids long scrolling. Save edits before changing devices because unsaved drafts remain in that browser.

## Review and finalize creative choices

Open **Creative library** to find Roxy Kane, False Fortune, AL-1B, the recurring pistol, voice records, ship environments, and episode wardrobe. The initial design directions are proposals; nothing is pre-finalized.

1. Open an asset and edit its creative brief or continuity notes.
2. Compare the proposed directions, add another option, or archive an option you no longer want to pursue. Archived options can be restored.
3. Upload local reference files to the appropriate option, or attach files already in the media library.
4. Save changes to MongoDB.
5. Click **Finalize this option** to save the selected direction and its reference snapshot.

A visual asset needs an image or video before it can be finalized. A voice needs an audio audition; its ElevenLabs voice ID and delivery notes can be recorded with the option. Files are imported as local originals, not as remote links.

Saving creative edits to an asset reopens its final choice for review. Changes to asset use, episode assignment, review status, or archive organization preserve approved references, character sheets, and scene approvals. **Decision history** contains up to 30 prior saved versions, including previous final-choice snapshots; each can be downloaded as JSON. Referenced media is retained when an option is archived, detached, or superseded.

## Library organization and review states

Use **Reusable** for recurring characters, droids, props, ships, sets, and voices. Use **Episode only** for wardrobe, locations, props, or staging specific to an episode, and select the episode in the editor. Both new and existing assets support this assignment. The episode scene editor offers reusable assets and assets assigned to that episode; the server rejects links to another episode's assets.

The library has three review states:

- **In development**: the asset is still being prepared. This can be set explicitly while work continues.
- **Pending choice**: options with saved media are ready for a decision, or the asset has been explicitly marked for review. The pending count and status filter collect these items.
- **Finalized**: an option with saved reference media has been approved using **Finalize this option**.

Click **Un-finalize** beside a finalized asset's status to reopen it as **Pending choice**. Its media, options, and previous final choice remain in history. Approving an option again creates a new finalized reference; identity-dependent sheets and scene approvals may need renewed review.

Keep voice auditions and model comparisons inside the main voice asset. **Library organization → Consolidate comparison** copies a comparison's options into the chosen main asset and archives the original record as linked **Comparison history**. If the selected production voice already matches, the completed comparison is retained as archived options. Unresolved new options mark the main asset **Pending choice** while its approved reference remains available until a replacement is selected. Use **Keep current choice** to retain the current option. Consolidation preserves the existing approved reference; transferring a different approved selection from a separate comparison requires finalizing that imported option on the main asset.

**Archive asset** removes a record from current collections while preserving its originals and history. **Archive** lists those records and **Restore asset** brings one back. Organization, archival, and consolidation use revision checks so stale edits cannot overwrite a newer saved record.

## Individual shot images and rejection

Each clip's scene image is reviewed independently in the episode and Creative library. One option contains one image. If a clip has alternatives, each image has its own **Approve image** button, and choosing one does not approve another clip's image. Video generation waits for that clip's exact approved image. The previous Scene 2 multi-image bundle has been split into three clip-specific reviews.

Generator previews use each clip's standalone action, dialogue, camera and sound directions, plus compact names/statuses for the linked references. They do not repeat the full scene script or stale asset-review notes in every shot. The scene script remains available for story review. Wan prompts still show their 4,500-character validation; long shot instructions are flagged rather than truncated. Actual provider submissions require the selected mode's current form and the appropriate approved visual/audio references.

**Reject & delete** permanently removes the studio's stored image, video or audio file and MongoDB media record, removes that choice or take, and clears references from decision history. Other alternatives remain available. Rejecting the current selection also clears its approval/selection and any related upscale request. This includes ElevenLabs voice auditions and episode dialogue recordings. If that same file is currently approved in another asset or selected in another clip, the server identifies that use and retains the file until that decision is resolved. This is separate from detaching a reference or organizing an asset with Archive. There is no archive step when rejecting a file.

Shot-image reviews, video and dialogue takes, reference attachments (including voice auditions) and the Media library expose the rejection action. Studio copies are deleted; the app does not delete external files originally imported from Downloads or elsewhere, or delete voices/history from the ElevenLabs account. Open drafts retain their text edits while deleted media references are removed, so saving a draft cannot restore a rejected take.

## Character and prop sheets

Every character and droid has a **Character sheets** section in its Creative library editor. Props have a **Prop sheets** section with the same review workflow. After selecting a design, upload or select a saved sheet image, select the views actually visible, and save the sheet. Review the result, then approve it to make it available as a reusable reference. Characters and droids cover front, three-quarter, side, rear, and face detail. Props cover both sides, top, rear, and a detail view, adding front and three-quarter views when useful. Missing views are shown in the editor. Keep episode wardrobe references separate from character identity. All future characters, droids, and props follow this sheet standard.

Sheet registration and approval preserve the finalized identity and record revision history. Pending sheets are excluded from prompt reference IDs and CapCut packages. Approved sheets are included only while they match the same finalized identity; changing or re-finalizing the identity marks earlier sheets as belonging to a previous identity. Saved sheets can be approved while asset edits remain unsaved: approval applies to the saved identity and preserves the local draft. A current draft receives the sheet's updated revision; an older conflicting draft remains recoverable and must be reconciled before saving. Adding a new sheet requires saving asset edits first. Sheet coverage is recorded by the reviewer, not automatically detected from the pixels.

## Local media and durable records

MongoDB database `roxy-starwars` stores asset records, candidates, finalized snapshots, media metadata, series settings, episodes, scene approvals, and revisions. New collections use the `StudioAsset`, `StudioMedia`, `StudioEpisode`, and `StudioSettings` Mongoose models. The existing sample `tasks` collection is left intact.

Original uploaded bytes live in `.data/media`, under generated unique filenames. MongoDB retains the original filename, content type, byte count, SHA-256 checksum, and ZIP checksum. The API returns record-based media URLs rather than exposing filesystem paths. Image, video, and audio previews use local routes with HEAD and byte-range support. Video controls use inline playback, including on mobile browsers.

Supported imports are PNG, JPG/JPEG, WebP, GIF, MP4, WebM, MP3, WAV, M4A, and OGG, up to 250 MB per file. Extension and signature checks reject obvious type mismatches; they are not a full codec validation. Use broadly supported video/audio codecs for playback on your target browser. Each upload is bounded and buffered before saving, so large imports temporarily consume up to the file limit in server memory. A failed metadata write removes only that newly written upload.

Back up **both** the MongoDB data and `.data/media`; record metadata alone cannot reconstruct original files. The automatic development MongoDB stores its files in `.data/mongodb`. Stop it cleanly before making a filesystem copy of those database files, or use MongoDB backup tooling. The entire `.data` directory and local environment files are ignored by Git.

Unsaved editor drafts are retained in the current browser. Saved records and final choices live in MongoDB. Revision checks return a conflict instead of overwriting another tab's saved changes. After a conflict, refresh the workspace to fetch the latest record; **Export draft and reload saved version** downloads the working draft, clears only that editor's browser draft, and loads the latest fetched record in the editor. Clearing browser storage removes unsaved drafts but does not affect saved records or media. An asset can be opened directly with `/?asset=<asset-id>`.

## Plan and approve an episode

The **Episodes** overview shows a short synopsis, production status, target runtime, scene approval counts, and planned clips and selected takes. Choose **Open episode** for the full outline, continuity notes, and scene board. Edit **Episode summary** in that workspace to change the overview synopsis; the full outline is stored separately. Episodes without a summary show only a short excerpt of their outline until a summary is added.

Create an episode in **Episodes**, write its premise, then add scenes. Each scene records its presentation style, location, script, linked library assets, and planned clips. Each clip has an editable duration from 2 to 30 seconds, action, speaker-labelled dialogue, camera direction, and sound effects. The initial duration is just an editable estimate. There is no fixed clip count or ten-second rule.

The workspace totals the planned runtime and vlog/cinematic percentages. Save an episode before approving a scene. Approval records the scene script, planned clip directions and durations, and current revisions of linked creative assets. Editing these inputs marks the saved approval as needing review. Selecting a video take alone does not change the approved script.

**Preview generator prompts** creates separate image and video directions from the current episode draft and linked library records. These are local templates, not AI-written scenes or submitted generation jobs. Video prompts include exact dialogue, effects, and the no-music requirement, and show the Wan prompt-length limit. Review and adapt prompts for the actual mode and references before any provider submission.

Every image and video prompt starts with explicit **Star Wars universe, Imperial era** guidance, including when a clip has no linked assets. Write each clip's action description with that setting and concrete visible details rather than relying on place names alone. The approved ship, character and set references remain authoritative for their designs.

## Take review and CapCut export

Import video takes under their planned clips. The Creative library's **Pending choice** count includes clips with saved video takes and no selected take. **Pending episode video choices** links to the episode workspace, where **Pending video choices** jumps directly to each clip's players. The Episodes overview also marks episodes with pending video choices. Alternate takes on an already selected clip do not create new pending decisions.

**Video takes to review** sits directly below each clip's title and duration, before shot descriptions and the separate dialogue audio players. It shows a player for each attached take. Play it with sound, then click **Approve video take** if accepted. This saves the selection immediately and records its 1440p (2K) upscale request; save any draft edits first. Failed approvals leave the choice pending. Importing a take alone does not select it. Earlier selected files remain compatible with the **Selected video take** control, whose draft changes still require **Save episode**. Attaching or selecting a take preserves the scene's script approval; changes to scripts, shot directions, or referenced assets still require renewed review. Preserve alternate files in the media library. **Download production brief** exports the saved episode and prompt previews as JSON for review.

Dialogue performances attached to a clip appear under **Dialogue to review**. Compare each recording with the finalized voice, listen for exact words and pronunciation, then click **Use this dialogue** and **Save episode**. **Clear dialogue selection** reopens the performance choice. These episode recordings do not replace reusable voice references. Selected dialogue is included in the CapCut editing package and identified separately in prompt metadata; it is not automatically submitted to a video generator or lip-sync service.

Choosing a video take and saving the episode also records an automatic **1440p (2K) upscale request** for that source video. The original stays in the media library. Repeated saves do not duplicate the request. Clearing or changing the selected take clears or replaces its active request; the episode history retains prior selections. The current OpenArt connection cannot submit video-upscale jobs, so the clip displays **2K upscale waiting for provider connection**. This status means no upscale has been submitted or charged. The app does not yet produce or export an upscaled master automatically, and does not mark a request complete just because a larger resolution was requested.

Previously selected videos that predate this policy receive their missing request on the episode's next save, with the same take selection and scene approval. Saving again retains that request.

**Download CapCut package** becomes available when every scene has current script approval and every clip has a selected video take. The server checks these requirements again. The ZIP contains the selected original video files, media attached to linked finalized assets, and an ordered `manifest.json` mapping scenes and clips to files. It supports packages below 4 GB. Extract the ZIP and import the desired originals into CapCut; this is an editing package, not a native CapCut project file or an assembled episode. Original voice files are included when attached to the linked finalized voice assets.

## Provider integration status

The workspace refreshes saved records when the window regains focus, when it becomes visible, and every 30 seconds while visible. **Refresh workspace** fetches updates immediately. An open editor follows saved updates when it has no unsaved changes. Older episode drafts use their original revision in saved history to merge new media and other nonconflicting updates while retaining local edits. The original draft is backed up in browser storage before the merged draft is persisted. **Save episode** then saves the combined version using the current revision; it does not select pending videos automatically. A save conflict also refreshes the saved record without discarding the draft.

If the same field was edited in both versions, saving pauses and lists the conflicting fields. Choose **Keep my edits in conflicting fields** or **Use saved values in conflicting fields**; unrelated changes are retained either way. Saved pending videos remain viewable during conflict recovery. If the original revision has aged out of the 30-version history, automatic merging is unavailable; **Export draft and reload saved version** preserves a downloaded copy before loading the current record. Asset drafts retain their existing export-and-reload recovery. Newly saved reference sheets remain visible and can be approved even while an older asset draft is open. Sheets awaiting review appear before approved sheets. Approval is disabled while a save is in progress, when a sheet is already approved, or when it belongs to a previous identity.

GPT Image 2.5 Sunburst at 2K/high quality for all images, Wan 3.0 at 16:9/480p for review, ElevenLabs voices, and CapCut final assembly are the production choices. Image prompt previews include the shared model/settings policy, and the series settings persist it in MongoDB. [Production chat](PRODUCTION-CHAT.md) can write reviewable story drafts and submit image, video and dialogue jobs after its ChatGPT-plan/OpenArt connections are configured. It imports completed originals as unselected candidates/takes and enforces the script, image and dialogue approval gates. It does not automatically approve generated work or submit the separate upscale queue. Preserve earlier files and approvals until the user chooses replacements.

## Sound design and finished video review

The production order is: **approve scene script and sound plan -> approve images and dialogue -> generate video -> approve sound options -> create finished sound mix -> approve mixed video -> 1440p upscale request**. Existing approved video selections remain valid. A new video cannot be approved directly from its raw render.

Each episode scene has a **Sound design** panel. Add continuous ambience and timed effects, describe their sound, choose the applicable clips, set level/trim/timing, and save the episode. A new scene approval includes its sound plan. Previously approved scripts have a separate **Approve sound plan** action, so sound changes do not reopen approved images or dialogue. A changed script or plan requires renewed sound approval before generation or mixing.

Sounds live in Creative library under **Sound effects & ambience**, with reusable and episode-only scope. Link an approved sound, import saved audio, upload a local audio file, or request a new ElevenLabs option. Each option has its own audio player, **Approve this sound**, and **Reject & delete**. New audio is never automatically approved. Generating a replacement marks its sound asset pending choice; approve the replacement or keep the prior option before mixing. Reusing audio and mixing locally spend no generation credits. New ElevenLabs effects display an estimate of 40 credits per generated second; the job records the provider's actual charge when returned. The sound API uses `eleven_text_to_sound_v2`; selected Eleven v3 character voices remain unchanged. See [ElevenLabs sound generation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

After the plan and individual sounds are approved, choose each clip's original video and click **Create sound mix**. The local FFmpeg worker copies the original video stream, retains its synchronized dialogue/audio, mixes approved effects underneath, limits peaks, and saves a separate effects-only WAV stem. Levels, source trim, looping, optional low-pass filtering and timed offsets are explicit in the plan. All-scene looping ambience advances through the scene across clip cuts. Sources that are too short without looping fail visibly. No music is generated or added.

The finished video appears as another unselected take in its clip. Listen and approve that mixed take to request the existing 2560 -> 1440 upscale. The upscale remains **waiting for provider connection** until a supported upscale provider is connected; mixing does not submit a paid upscale. Changing the approved sound, dialogue selection, source or sound plan makes the prior mix unsuitable for new approval/export. Existing selected stale mixes are flagged for renewed review. Original source files remain available. Delete a derived mixed video before deleting its source or effects stem, which protects retained mixes from dangling file references.

Sound jobs continue on the studio PC after the phone page closes, and their statuses refresh on the scene page. Jobs interrupted during paid submission become uncertain and are not automatically resubmitted. The editing ZIP includes selected mixes, original sources, selected dialogue, approved sound files and effects stems, with links in its manifest. Use either the finished mix or its component tracks in CapCut to avoid doubling audio. Add music there.

Production chat can request `request_sound_effect` for an approved plan layer or `request_sound_mix` for a clip with approved sounds. It can never approve sounds, select videos, or skip review gates. The scene panel is where you edit and approve the sound plan.

## API and implementation

| Method      | Route                                                         | Purpose                                                       |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| GET         | `/api/studio`                                                 | Load the workspace and insert missing initial library records |
| POST        | `/api/studio/assets`                                          | Create an asset                                               |
| PUT         | `/api/studio/assets/:id`                                      | Save an asset with its expected revision                      |
| PATCH       | `/api/studio/assets/:id/organization`                         | Change scope, episode, review state, or archive metadata      |
| POST        | `/api/studio/assets/:id/consolidate`                          | Copy options to a main asset and archive the comparison       |
| POST        | `/api/studio/assets/:id/finalize`                             | Finalize a saved candidate with media                         |
| POST        | `/api/studio/assets/:id/reopen`                               | Reopen a final choice                                         |
| POST        | `/api/studio/assets/:id/character-sheets`                     | Add an image sheet for review without reopening the identity  |
| POST        | `/api/studio/assets/:id/character-sheets/:sheetId/approve`    | Approve a sheet for the current identity                      |
| POST        | `/api/studio/media`                                           | Import raw file bytes with an encoded `X-File-Name` header    |
| GET or HEAD | `/api/studio/media/:id`                                       | Preview or download an original, with range support           |
| POST        | `/api/studio/episodes`                                        | Create an episode                                             |
| PUT         | `/api/studio/episodes/:id`                                    | Save an episode with its expected revision                    |
| POST        | `/api/studio/episodes/:id/scenes/:sceneId/approve`            | Approve a saved scene                                         |
| POST        | `/api/studio/episodes/:id/scenes/:sceneId/sound-plan/approve` | Approve the saved sound plan for an existing approved script  |
| POST        | `/api/studio/assistant/sound/generate`                        | Queue one ElevenLabs sound option for an approved plan layer  |
| POST        | `/api/studio/assistant/sound/import`                          | Attach saved audio as an unapproved sound option              |
| POST        | `/api/studio/assistant/sound/mix`                             | Queue a local sound mix for one original video take           |
| GET         | `/api/studio/assistant/sound/jobs`                            | Read sound and mix jobs for an episode and optional scene     |
| POST        | `/api/studio/prompts`                                         | Preview local prompt templates                                |
| GET         | `/api/studio/episodes/:id/brief`                              | Download a saved production brief                             |
| GET         | `/api/studio/episodes/:id/package`                            | Download the editing ZIP                                      |
| PUT         | `/api/studio/settings`                                        | Save the series bible with its expected revision              |

The service binds to localhost by default and requires the single owner's login for studio records and media. See [remote access](REMOTE-ACCESS.md) for authenticated HTTPS phone access. React source lives in `client/src`, studio routes in `server/src/routes/studio.js`, record schemas in `server/src/models/Studio.js`, and file handling in `server/src/studio-media.js`. The production assistant lives in `server/src/assistant` and exposes only the specific OAuth callback and expiring provider-source grants publicly.
