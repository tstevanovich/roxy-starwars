# Roxy Star Wars production brief

Roxy Kane leads a fictional Star Wars adventure series set during the Imperial era. Each episode targets roughly ten minutes and combines humor, action, flirtation, cinematic dialogue, and a coherent plot. The existing YouTube channel is [The Roxy Kane Show](https://www.youtube.com/@TheRoxyKaneShow); [Chloe VS History](https://www.youtube.com/@ChloeVSHistory) is the reference for the personal vlog presentation. The supplied [creator tutorial](https://www.youtube.com/watch?v=T57fM8aeUrA) remains a reference to review, not a verified production recipe.

The decisions below define the production studio. The local React, Express, and MongoDB application now includes an asset library with candidate review and finalized choices, local media uploads and playback, a series bible, episode and scene editing, script approvals, model-specific prompt previews, and an editing ZIP export. Production chat can draft story and production plans and request authenticated OpenArt image/video and ElevenLabs dialogue/effect jobs. Owner review remains mandatory; see the production approval board in the studio guide. See the [studio guide](STUDIO-GUIDE.md) for the implemented workflow and storage details.

## Episode format

Approximately one-third of finished runtime is Roxy speaking directly to the audience in vlog style. The remaining two-thirds is cinematic interaction, dialogue, and action. For a ten-minute episode this is approximately 3 minutes 20 seconds of vlog material and 6 minutes 40 seconds of cinematic material. This is a pacing target, not a fixed quota for every scene.

An interplanetary episode needs visible travel coverage: establish the named departure world and pickup location, show the ship outside on the pad, departure and atmospheric ascent, normal-space flight, a hyperspace transition and cockpit view, the named destination's approach and landing, and a clear departure or endpoint. Budget this coverage inside the cinematic runtime. An outline must identify these images and transitions rather than implying the entire trip through interior dialogue. Travel time can be compressed editorially; a ten-minute episode does not imply a ten-minute in-universe journey.

Scenes determine clip lengths. There is no fixed shot count or ten-second clip rule. Each clip needs enough time for its dialogue, pauses, action, and camera movement. Wan 3.0 currently accepts explicit durations from 2 to 30 seconds; longer scenes use multiple deliberately composed clips. The editor shows total planned runtime and the vlog/cinematic balance without forcing unnecessary cuts or padding.

## Recurring characters and assets

| Asset            | Confirmed identity                                                                                                   | Design status                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Roxy Kane        | Adult female smuggler; confident, seductive, funny, motivated by credits; talented pilot and skilled pistol marksman | Original identity sheet imported and approved; use the current finalized references in the studio                             |
| False Fortune    | Roxy's ship; also called the Fortune                                                                                 | Freighter design and Round 03 exterior turnaround/boarding detail finalized; preserve geometry across flight and ground views |
| AL-1B            | Spoken nickname Al; male droid; copilot, mechanic, and AI assistant with a funny personality                         | Navigator design and multi-view sheet approved; British deadpan audition selected, v3 production check awaiting review        |
| Roxy's pistol    | One recurring primary weapon, with consistent holster and handling                                                   | Canonical pistol and matching holster sheet approved; track occupied holster and draw/re-holstering                           |
| Episode wardrobe | A different Roxy outfit each episode, with visible cleavage and midriff                                              | Episode 01 outfit/occupied-holster sheet approved; each later episode receives a separate outfit choice                       |
| Recurring sets   | Ship exterior, cockpit, cargo hold, engineering area, quarters, and boarding access                                  | Core ship set directions selected; develop additional camera coverage and planetary/travel references as required             |

The Fortune is an alias for False Fortune, and AL is an alias for AL-1B. Each pair refers to a single asset. Approved references should cover useful angles, scale, layout, and materials. Ship geography, weapon appearance, drawn/holstered state, wardrobe, and accumulated scene damage must remain consistent across takes.

The droid's spoken nickname is **Al**, one syllable, rhyming with **pal**. Write `Al` in spoken dialogue and ElevenLabs input so it is read as a name. Do not pronounce the nickname as the letters A and L. Keep `AL-1B` as his formal designation and `AL:` where needed as a script speaker label. Video prompt previews normalize spoken `AL` references to `Al` and include pronunciation direction; saved scripts and visual reference names retain their original spelling. Existing recordings need a new take to change their pronunciation.

Roxy uses charm and flirtation as tactics within a story driven by her choices, competence, and pursuit of credits. AL must remain useful at navigation, maintenance, and problem solving while supplying humor.

Roxy enjoys casual sex without romantic commitment or exclusivity. She is attracted to men and women, including adult sentient nonhuman partners. Establish this through her choices, banter, chemistry and implied encounters. Her sexuality does not require a committed relationship arc or a sexual encounter in every episode. Tavin may recur as a rival, contact, occasional attraction or casual partner, without becoming her boyfriend, permanent passenger or inevitable romantic destination. She can care about people and remain loyal to friends while maintaining these boundaries.

Principal and recurring characters and droids use the supplied production reference package: a clear neutral three-quarter master portrait; a body turnaround with complete front, three-quarter, side-profile and rear full-body views, including heads and feet; neutral, amused, angry, worried and surprised expressions; an exact costume reference with shoes and accessories; written identity; and separate useful view files. One character and one outfit per turnaround. Return to the original approved identity references when generating replacements. Each package item needs its own review. Props and weapons use prop sheets showing both sides, top, rear and useful details. Keep proportions, features, markings, materials and accessories consistent. Record only views actually visible; an absent view remains pending. Episode outfits remain separate choices.

The studio stores sheets on character, droid, and prop records, with image references, covered views, and a separate approval. Adding a proposed sheet preserves the finalized design. Only approved sheets tied to the current design are included in prompt reference IDs and editing packages. A changed or re-finalized design requires a new sheet review. This is the production standard for future assets; an initial single-view concept is not a complete production sheet.

## Voice production with ElevenLabs

ElevenLabs is the selected source for reusable character voices. The application and local production scripts use the server-side credential to generate dialogue and effects and save local audio for individual review. Selected voice IDs and auditions are recorded in MongoDB and local production manifests. The user approved Roxy's Eleven v3 comparison C as her preferred production rendering, using stability `0.5` with her saved voice ID. The selected v3 recording is now the current sound reference; the original Voice Design audition is preserved as history. Al and Tavin's production rendering still requires their own listening approval. Record the voice ID, model, settings and approved sample together; a matching voice ID alone does not approve a changed rendering.

Roxy's confirmed voice direction is American English, a lower female register, confident and teasing. Al's selected audition is a precise British male performance with dry comic timing; his consistent droid-processing treatment remains open. Tavin's selected audition is a cultivated American male performance with conversational charm. Recurring characters receive their own saved voice identities and individually reviewed production renderings.

Audition suitable existing voices or use [ElevenLabs Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design) to create candidates from descriptions. Approve a candidate before saving it as a character's production voice. Store the voice ID, model, supported delivery settings, pronunciation choices, and a reference sample so subsequent dialogue reuses the same identity.

The planned workflow is script approval, dialogue generation, voice-take review, duration measurement, and then video planning around the approved performance. Allow time for reactions and action rather than speeding dialogue to fit a preset clip. Preserve original dialogue files and useful alternate performances.

Wan's element-reference mode accepts audio references, but a voice reference does not establish that the model will reproduce an ElevenLabs performance verbatim or synchronize every syllable. Validate voice identity, exact wording, and visible mouth timing in a short pilot before selecting a production method. Dedicated lip synchronization may be needed when the original ElevenLabs recording must be the final audible performance. That additional method and its provider are not selected.

The [ElevenLabs speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) supports reusable voice IDs and selectable output formats. Account access, model availability, usage allowance, and export quality must be verified during integration. Keep provider credentials on the server and outside version control.

## Image production and model selection

Use OpenArt **GPT Image 2.5 Sunburst** (`gpt-image-2-5-sunburst`) for all image production: characters, droids, props, wardrobes, ships, environments, and episode stills. The current default is 2K, high quality, 16:9, PNG. Use approved image references to carry character identity, the episode outfit, ship geometry, locations, and props into each composition. The shared application policy is stored in `shared/production-defaults.ts` and returned with clip prompt previews.

The user selected GPT Image 2.5 after comparing exterior and cockpit renders from GPT Image 2.5 Sunburst, Grok Imagine Image 2.0, and Seedream 5 Pro. This replaces Nano Banana as the default for all image categories. Preserve earlier images and their original model provenance. Re-render the active production library as new candidates using selected designs as references; the user reviews the complete batch before finalizing replacements. A model change does not itself approve a new identity, sheet, set, or scene. Exact provider forms and complete reference packs must be included in price quotes.

Image prompts describe a still frame: subject identities, reference roles, pose and expression, wardrobe, prop placement, environment layout, framing, lens character, lighting, and realistic materials. They do not inherit video timing, dialogue instructions, or sound directions.

Every clip description and each image/video generation prompt explicitly names the **Star Wars universe, Imperial era**. A location name alone is insufficient context. Pair it with visible setting details: for the original Coronet freight apron on Corellia, describe a weathered industrial coastal spaceport, utilitarian landing pads, freight infrastructure and hazy daylight. Cockpit shots identify the approved False Fortune interior and its grounded or flying state. Approved references control original ship and character designs; the franchise cue is setting guidance, not a substitute for those references or a guarantee of canonical accuracy. Include only characters, droids and vehicles requested for that shot.

For reference-based images, use the current GPT Image 2.5 Sunburst `image2image` form with `prompt`, `visualReferences`, `resolutionTier: "2k"`, `quality: "high"`, `variant: "sunburst"`, `aspectRatio: "16:9"`, `imageCount: 1`, `outputFormat: "png"`, `lockAspectRatio: true`, and `autoEnhancePrompt: false`. Keep automatic prompt enhancement disabled for approved prompts. Other modes require their own validated forms.

Suggested image prompt structure:

```text
UNIVERSE AND ERA: Star Wars universe, Imperial era; describe the visible setting.
REFERENCE ROLES: Identify the approved character, outfit, set, and prop references.
FRAME: Describe one visible moment and each subject's exact position and expression.
CONTINUITY: Specify the outfit, weapon state, spatial relationships, and relevant prior damage.
CAMERA AND LIGHT: State composition, viewing angle, lens character, light sources, and exposure.
REALISM: Specify natural skin, believable materials, coherent anatomy, and practical set detail.
```

This is an application prompt template, not a claim that the model requires these headings. Replace the instructions with scene-specific content before submission.

## Video production with Wan 3.0

Use OpenArt model `wan3-0`, Standard mode, at native **1080p (1920 × 1080)** with a 16:9 composition. Use the scene's required duration, up to the current 30-second limit. Render the final resolution on the first pass; do not generate 480p review videos or request an upscale.

The native 1080p policy supersedes the earlier 480p-to-1440p workflow. Owner picture, performance and sound approval accepts the final-resolution video directly. There is no separate upscale stage or automatic upscale request. Preserve previously approved files and high-resolution deliveries. Corrected native 1080p files made manually in OpenArt can be imported into their matching clips: verify dimensions, duration and audio, then leave each as an unselected take for owner review. Importing does not approve or replace the existing selection. Never silently substitute a different generation model.

Choose `element2video` to stage approved characters and assets in a new composition, including audio references where useful. Choose `image2video` when an approved scene image must be the literal first frame. The current image-to-video form derives composition from its start frame and does not expose the same reference or aspect-ratio fields as element-to-video; do not reuse one mode's payload blindly in the other.

Video prompts describe motion and performance: starting state, ordered action beats, exact speaker-labelled dialogue, reactions, camera movement, physical interaction, sound events, and the final state. Match the amount of action and speech to the selected duration. Preserve subject identities and relevant continuity from the approved references.

Track every character's physical presence across cuts. A silent listener remains present in their established seat or position whenever it is visible. Excluding a character from a shot means framing that position out of view, not showing it empty. Conversation coverage uses eyelines toward the other character; direct lens contact is reserved for deliberate audience address. In Episode 01 Scene 2, clip 1 is Roxy's vlog with Al still at his copilot controls. Clips 2 and 3 show Roxy and Al looking toward each other from the original left pilot and right copilot chairs. Both seats stay occupied. Preserve the same side of the conversation axis, cockpit geometry and lighting between shots.

The user rejected the wide shots showing both full seated characters. Use close speaker coverage, with the listener outside the frame or partly visible over a shoulder. Do not force a two-person chair composition merely to prove continuity. The Fortune is parked throughout this scene: keep camera and port landmarks fixed, with no forward drift, scrolling window scenery, parallax, acceleration or passing foreground vehicles. Start revised proposals with a stationary, uncluttered apron and parked Star Wars spacecraft. Background motion must not imply that the ship is traveling.

Inspect background traffic as carefully as the foreground cast. The Coronet freight-apron window view uses original Star Wars-style repulsorlift cargo sleds/landspeeders and distant spacecraft. Exclude contemporary Earth automobiles, tires, road cars, trucks, buses and lane-marked modern streets from these shots. Check the actual motion footage for vehicle drift; a correct starting image or the words "Star Wars" do not establish that the generated background remains correct.

Scene 2, Clip 2 was rejected again because cars and wheeled cargo vehicles remained in the window view. Its replacement must show **no ground vehicles of any kind**, including hovering substitutes, wheeled baggage carts, forklifts, trucks or trailers. Use static open duracrete, stacked cargo containers and fixed port architecture instead. Correct the exterior window contents only; preserve the approved cockpit, occupants, framing and mutual eyelines. Review the replacement image before generating another video. Checking that port landmarks are stationary does not establish that the visible objects are appropriate.

Keep `audio` enabled for native-audio generation and `promptExtend` disabled for approved prompts. Element-to-video also exposes `autoEnhancePrompt`; keep it disabled. Standard is the initial economical tier to evaluate, with Prime considered for shots where a measured improvement justifies the additional cost. Neither tier is assumed to satisfy the quality target without take review.

Scene 2, Clip 2 exposed a reference-mode failure: Wan added car-shaped traffic even when its approved reference image had a clear apron. The corrected take uses Wan's literal `image2video` mode with the same approved image as both `startFrame` and `endFrame`, `audio: false`, and minimal character motion. The finished clip adds the original selected Eleven v3 Al recording at 0.8 seconds, muffled already-approved Scene 1 port effects and a soft console click. Al's fixed grille requires no human lip animation. The final review file includes this assembled audio; the silent intermediate is not a finished take. This method preserves the selected performance instead of asking the model to recreate it. It is verified for this Al shot, not established as a human lip-sync workflow. Inspect actual window contents throughout the motion; frame constraints still do not guarantee a correct result.

Suggested video prompt structure:

```text
UNIVERSE AND ERA: Star Wars universe, Imperial era; describe the visible setting.
REFERENCES AND START: Bind each character, prop, environment, and voice reference to its role.
SHOT AND DURATION: State the vlog/cinematic presentation, camera setup, and intended duration.
PERFORMANCE: Describe a feasible sequence of action, dialogue, pauses, and reactions in order.
DIALOGUE: Assign each exact approved line to its speaker and describe delivery.
CONTINUITY AND END: Specify weapon state, object handling, spatial relationships, and end position.
AUDIO: Name synchronized effects and ambient sounds. No music, score, soundtrack, or musical bed.
```

Use natural timed beats where helpful; timing instructions are direction to the generator and require review against the actual result. The current prompt field is limited to 4,500 characters. The application must validate each mode against the current provider form before submission.

## Sound and final assembly

Generated video clips must include appropriate sound effects and environmental audio, such as footsteps, blaster discharges, impacts, doors, machinery, and ship ambience. They must contain no generated music. Check actual audio before approving a take; a prompt alone does not ensure compliance.

Busy starports need audible activity beyond a steady engine hum. Lead with smooth, moving repulsorlift traffic and distant spacecraft flybys, supported by restrained distant crowds, footsteps, occasional electronic terminal sounds and unintelligible comms. Avoid sputtering engine starts, combustion-motor revving, rusty hinges, creaking metal and grinding machinery; the user rejected those sounds for the Corellia starport. Generate separate sound layers when useful so traffic, crowds and individual events can be balanced independently. Carry a continuous ambience bed across adjacent shots when practical. Preserve approved visuals and original takes when revising sound, and save revised versions for listening review. Do not add music or intelligible background dialogue.

CapCut is the final editor. The user assembles the selected clips and adds a separate background music track there. The app can prepare original instrumental ElevenLabs music after owner approval of its complete music brief. Request one audio file per call, using the scene runtime plus at most five extra seconds for silence allowance: the current 37-second arrival scene requests 42 seconds, not 37 or 50. No automatic paid retries. Detect edge silence locally, preserve the original and prepare a scene-length WAV with a short final fade when enough audible material exists. The owner listens and approves one take; insufficient material remains visibly unapproved. Music edits never reopen unrelated image/video approvals. Export approved music, selected video takes, original ElevenLabs dialogue, independent sound files, scripts, and an ordered shot manifest. Never add music to Wan prompts or mix music into production clip soundtracks. Do not promise separate dialogue/effects stems from a provider that returns only a mixed track. Preserve effects when repairing dialogue; do not silently mute the entire clip or layer a second speaking voice over the first. The Sith Inquisitor series has no opening crawl; Episode 1 begins directly with Arrival at Korriban.

## Approval and generation workflow

The production approval board versions source research, outlines, scripts, reference packages, shot plans, storyboards, timed animatics, visual reviews, final video delivery and export readiness. Owner approvals gate supported production requests on the server, including requests made through chat. The original Imperial project retains its existing workflow until explicitly enabled. A scene's review package includes its dialogue, action, location, cast, wardrobe, relevant references, planned clips and durations, selected models, settings, and credit quote. Image references and voice candidates also need approval before becoming reusable production assets.

Scene approval authorizes preparation within that approved plan, but video generation also requires explicit user approval of the actual shot images and the selected dialogue performances. A generated image, assistant visual inspection, approval of reusable characters/sets, permission to make changes, or authorization to spend on a retry does not approve a new or revised shot image. After creating replacement images, stop at image review. Each clip has its own image review: one image per option, with an independent approval button. Multiple alternatives belong to that clip; do not combine three different clip images behind one approval button. Confirm the finalized image for each clip is the exact source image for its video before submitting motion jobs. Replaced framing, poses, eyelines, wardrobe or window views require renewed image approval. Premature outputs remain unapproved while awaiting a decision; spending credits is not acceptance.

The user explicitly requires **Reject & delete** for images, videos and audio, including ElevenLabs auditions and dialogue takes. Rejection permanently removes the studio's stored file, media record and references to that file; do not archive rejected media as a substitute. Keep other alternatives and approved work intact. Unchosen or unreviewed work is distinct from rejected work. Deleting a file still approved in another asset or selected in another clip requires resolving that actual shared use first. Update the application and any known managed production copies when carrying out an explicit rejection. Local file rejection does not delete the reusable voice or generation history in the ElevenLabs account.

The user clarified that routine voice or motion tests must not become additional confirmation checkpoints after the required script, image and dialogue approvals are already in place. Preserve the selected voices and references, report costs, then generate the authorized initial video takes and make them available for review. Obtain creative approval for material changes and replacement images; the standing credit authorization does not require another cost confirmation for a requested retry. Scene 2's prior voice/lip-sync test acceptance was a technical test, not standing approval of later replacement images. Completed video-take selection remains separate from script and image approval and accepts the native 1080p video for final editing.

The implemented review workflow for enabled projects is:

1. Review source evidence and approve asset briefs and the episode outline.
2. Finalize reusable designs and review required individual reference-package items.
3. Approve each scene script, shot plan and sound plan separately.
4. Review each actual shot image and select each dialogue performance.
5. Review each shot's storyboard continuity and timed still-image animatic before its video generation. Whole-scene reviews are optional batch reviews; unfinished sibling shots do not block an individually approved shot.
6. Generate one candidate per request with Wan native sound effects and ambience, plus the selected voice reference for speaking clips. Explicitly prohibit music.
7. Review picture, performance and sound together. Approve a good native soundtrack directly. Use separate approved effects and a replacement mix only when audio needs repair; preserve usable picture.
8. Use the approved native 1080p video directly, review separate background music if enabled, then approve the CapCut package. No upscale gate.

The current connector does not provide a dedicated exact audio-driven lip-sync route. Voice-reference generation requires owner delivery and lip-sync review. Native 1080p delivery requires no upscale connector. See [the studio guide](STUDIO-GUIDE.md#production-approval-board) for controls and server gates.

Changes to an approved script, identity reference, voice, outfit, or generation settings invalidate the corresponding creative approval for subsequent jobs. Preserve prior versions, takes, selection state, and feedback. The user has given standing cost authorization for requested production work and necessary corrective retries: "stop asking me and just do it. It cost what it costs." Proceed without repeated cost confirmations; quote and record charges, reuse accepted work, and keep retries focused on the requested correction. This cost authorization does not waive script, actual image, selected dialogue or finished video approvals. A replacement image must still be explicitly approved before its video is generated. Video approval does not request or authorize an upscale under the native 1080p workflow.

## Quality and credit use

The goal is cinematic, photorealistic footage with convincing performances and no distracting signs of generation. This is an acceptance target, not a guarantee from the model choice or an upscale.

Review facial identity and motion, hands, eyelines, lip synchronization, natural pacing, body mechanics, contact and impacts, prop continuity, geography, lighting, textures, sound effects, and the absence of music. Upscaling improves resolution; it does not repair acting, anatomy, continuity, or incorrect dialogue.

The user reports an OpenArt allowance of 106,000 credits per month and has not set a fixed episode budget. The monthly allowance is not the current available balance or permission to exhaust it. Show provider quotes, actual charges, and spending per episode. Track ElevenLabs usage separately from OpenArt credits.

Control cost by reusing approved assets, recording dialogue before expensive motion passes, quoting actual native 1080p settings, and rendering one candidate initially unless alternatives are requested. Avoid rerendering an otherwise accepted shot solely for a minor defect that can be handled during final editing. Never fall back to 480p or upscale without a new owner instruction.

## Initial studio scope

Build the series bible and reusable character, voice, wardrobe, prop, ship, and environment library first. The episode workspace should hold outlines, scene scripts, runtime balance, generator-specific prompt previews, approval records, cost quotes, take reviews, and CapCut exports. Persist those records in MongoDB and keep recoverable source media locally.

The initial review interfaces, MongoDB records, local file storage, and editing-package exports are implemented. ChatGPT-plan story drafting, OpenArt image/video generation, ElevenLabs dialogue/effects, and provider job tracking are integrated. Provider charges are shown only when returned; quotes and queue confirmations are not actual charges. Native 1080p generation and direct delivery are supported; a dedicated exact audio-driven lip-sync route remains unavailable.

## Creative proposals to review next

These are starting directions rather than confirmed designs:

- False Fortune: a compact, weathered working freighter with concealed capability and a recognizable silhouette. Its cockpit and connected interior sets should support repeatable camera positions.
- AL-1B: a practical droid whose body makes his copilot and mechanic roles believable. His humor can be dry and observant, with real competence underneath his complaints.
- Roxy's voice: a warm lower register, natural American delivery, controlled confidence, and an amused edge. Keep the clean voice master separate from any scene-specific processing.
- AL's voice: a clear male performance with precise timing and restrained sarcasm. Audition vocal personality before choosing a consistent droid-processing treatment.

The exact Imperial-era year, ship and droid designs, voice identities, and pilot premise remain open. They can be decided progressively while the studio is built.
