# Production chat

Open **Production chat** in the studio menu on desktop or phone. The assistant can discuss stories, draft scenes, create asset briefs, inspect saved images, request OpenArt image/video options and generate ElevenLabs dialogue using finalized voices. Conversations, proposals and jobs live in MongoDB; original media lives in `.data/media` on the studio PC.

Studio chat uses **Sign in with ChatGPT and your eligible ChatGPT plan**, with no API-key billing fallback. It reads the saved production brief and studio records. It does not import other ChatGPT/Codex conversations. OpenAI processes the AI requests; running the studio locally does not make the language model run offline.

## Morning setup: connect ChatGPT on the studio PC

1. On the studio PC, open **http://127.0.0.1:5000/?chat=1** and sign in to the studio with your existing owner login.
2. Open **Connections**, then **Continue with ChatGPT**. Complete OpenAI's sign-in in that PC browser, select the intended account/workspace and grant ChatGPT plan usage to **Roxy Kane Studio**.
3. Follow **Return to production chat**. Dismiss the one-time plan explanation with **Got it**.
4. Open Connections and choose a **ChatGPT model** from the account's discovered catalog. **Test connection** makes a short request using your plan. A sign-in badge or populated catalog alone does not prove that inference is available; a completed test/reply does.
5. Use **Manage usage** to review this app's permissions, plan/app limits and credits settings in ChatGPT. Eligible requests draw from your ChatGPT plan or available credits according to those settings. The studio does not purchase credits or switch to API-key billing when limits are reached.
6. Connect **OpenArt** separately if needed, from either the studio PC or its remote address. Check the prefilled Roxy OpenArt project ID and use **Test OpenArt connection**. The separate reference-sharing status shows whether the public HTTPS address is configured; keep the remote tunnel running so OpenArt can fetch local files.

The initial ChatGPT sign-in must happen in a browser on the PC that runs the server. OpenAI's local-personal-app flow returns to an HTTP listener on `127.0.0.1`. After setup, the PC handles requests and token renewal for the authenticated mobile website; the phone does not need its own ChatGPT sign-in. The Connections screen explains this and disables starting local ChatGPT sign-in from a remote address. Your studio owner login remains separate and is required on every device.

The existing `ELEVENLABS_API_KEY` in `server/.env` is reused. OpenArt renders and ElevenLabs recordings use their respective accounts/credits. The former OpenAI API-key setup route is disabled; `OPENAI_API_KEY`, `OPENAI_MODEL` and any previously saved OpenAI API key are ignored by studio chat. The optional OpenAI transcription call has been removed. No separately billed OpenAI API fallback is configured.

## Accounts, renewal and limits

Connections shows the active account, its distinct registration label/email, available models and whether a request has completed successfully. **Add account** creates a separate registration. Switching accounts does not combine credentials, and queued replies remain bound to the account/model selected when sent. Reauthorization reuses the account's issued client ID and this PC's stable host ID. A new identity is never silently substituted for an existing account.

The server validates OAuth state, S256 PKCE, the ID token signature/issuer/audience/expiry/nonce, and granted plan-use scopes. Credentials are stored in the existing AES-256-GCM vault: `.data/private/integrations.enc`, with its separate key at `.data/private/integrations.key`. Keep both in a private backup. The owner setup restricts that directory to your Windows user and SYSTEM. Access/refresh/ID tokens and the PKCE verifier are not returned by studio APIs, put in browser storage or sent as model context. The app never reads or copies another program's ChatGPT/Codex credentials.

Access tokens renew on the PC. Revoked/expired refresh access requires another local sign-in. Disconnect attempts to revoke the renewable session and clears local tokens while retaining the account/client mapping for future sign-in. If remote revocation cannot be confirmed, the UI explains how to disconnect the app in ChatGPT settings. Disconnecting ChatGPT does not cancel OpenArt jobs already authorized and submitted.

On a usage-limit/unavailable response, the current reply stops and preserves the message and any previously queued work. It does not retry through an API key or another account/model. Use **Manage usage**, then explicitly retry when access is available. A response stream must reach `response.completed` before its tool calls can run. Partial calls from a failed/interrupted stream are never executed.

The server streams responses from OpenAI internally while the phone polls the studio for updates. This works with the existing HTTPS tunnel without requiring browser SSE support. Stateless requests use `store: false`; MongoDB retains the conversation history. The server supplies its own namespaced production tools, not hosted OpenAI connectors or image-generation tools.

The live plan connection can omit the response's `Content-Type` header and send completed output items separately while the final event contains an empty `output` array. The reader accepts an omitted header, retains `response.output_item.done` items in their output order, and releases them only after a successful `response.completed`. An explicitly incompatible content type, failed/incomplete response or interrupted stream still cannot execute production tools. Regression fixtures cover this live response shape as well as the canonical full terminal response.

Official references: [local ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source), [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [ChatGPT usage settings](https://chatgpt.com/settings/usage), and [OpenArt MCP](https://openart.ai/mcp/).

## Choose creative context

Use **Discuss in chat** on an asset or episode, or **Discuss this clip** inside an episode. A new conversation can focus on the whole series, an asset, an episode, a scene or a clip. The assistant works from saved content; save local editor changes before asking it to revise them.

Example requests:

- “Read the current third scene and give Roxy a sharper final line. Keep Tavin recurring without a relationship.”
- “Draft a new 20-second cockpit exchange, with Al watching Roxy rather than the camera.”
- “Make another image option for this clip. Preserve the approved wedge head and keep the Fortune parked.”
- “Generate the dialogue for clip 4 using the finalized Roxy voice.”
- “The image and dialogue are approved. Request a video take for this clip.”

Attach up to four saved files or upload a reference from your phone. Images can be viewed directly. Saved videos can supply three sampled still frames using FFmpeg/FFprobe on the PC's PATH (or `FFMPEG_PATH` / `FFPROBE_PATH`). This does not prove motion quality between frames. Audio inspection returns file details and any saved clip dialogue; it does not listen or transcribe. Give your own feedback about pronunciation, voice quality, sound effects or music. The assistant must state these limits and cannot claim to have heard content it has not evaluated.

## Story drafts and approvals

A proposed scene appears in a **Story draft** card. Expand it to read the script and each clip's action, dialogue, camera, sound effects and duration. **Apply draft** saves it into the episode without approving it. It reopens the changed scene's script and shot images and clears that scene's selected dialogue/video performances, while retaining earlier takes and an episode history snapshot. Review and approve the scene in Episodes before production.

Story notes and outlines can also be saved as proposal cards. Applying a note appends it to episode notes. Applying a proposal requires the original episode revision, so another tab's newer edits cannot be overwritten silently. If the episode has changed, ask for a revised proposal against the latest saved episode.

## Render jobs and review

The chat has no approval/finalization/deletion tool. The existing review screens remain the place to approve, un-finalize, or **Reject & delete** images, video and audio.

- Each image request produces **one** separately reviewable candidate. Character, droid and prop requests specify a multiview reference sheet. Existing finalized choices remain authoritative while a replacement is pending.
- Scene production requires the current scene script and linked creative references to be approved/finalized.
- Video additionally requires exactly one approved clip image and selected dialogue whenever the clip has speech. Pending replacement images or unfinished image/dialogue jobs block video, even if an earlier image was approved.
- Image settings are GPT Image 2.5 Sunburst, 2K, high quality, 16:9. Video settings are Wan 3.0 Standard, 480p, 16:9, 2–30 seconds, sound effects and no music. Spoken clips reference the selected ElevenLabs recording using Wan's voice-reference mode. This generates a performance using that reference; it is not a promise of sample-identical audio. Review voice and lip sync before approval.
- OpenArt form/cost calls precede submission. Insufficient credits block the request. The user has authorized the costs of requested renders; there is no repeated credit-permission dialog. Up to six production requests can be created per assistant turn.
- Finished originals are downloaded into the local media library and attached as unselected candidates/takes. **Review image options** or **Open episode for review** opens the existing approval screen.

Existing provider image references are matched only to media still present in the library. Deleted/rejected files are not restored from old manifests. For a local-only reference, the studio creates a random, expiring, single-file provider URL so OpenArt can fetch it through the HTTPS tunnel. These grants expire after one hour, stop working after an owner credential reset or file deletion, and are removed when a render is successfully imported. Normal media URLs continue to require login. Keep the PC and tunnel running while a provider needs its references.

Reference sharing uses `STUDIO_PUBLIC_ORIGIN` when configured, otherwise the current tunnel origin in `.data/private/remote.json`, with an HTTPS OpenArt callback as a legacy fallback. It does not use a localhost OAuth callback as a public download address. The worker checks that each local reference URL serves the expected media type before requesting a quote or submitting a paid render. An unavailable tunnel stops the job before submission.

Production video prompts use the exact clip action, dialogue, camera, effects and requested changes, plus concise Star Wars and continuity directions. The approved image carries visual design instead of appending the entire library's reference descriptions. The complete submitted prompt is checked against Wan's 4,500-character limit before a video job is queued; overlong directions are reported without silent truncation.

## Background work and recovery

Messages and queued jobs are persisted before work starts. The page polls for results, so phone sleep or a disconnected tab does not stop a job. One server worker serializes requests. Keep a single production server for this database; development servers must not run their own worker against the same production database on another port.

Queued submissions and unfinished imports take priority over status polls, so existing renders cannot keep later clips from being submitted. Polls use the earliest due check and respect the provider's requested delay.

Known OpenArt history IDs are retained across server restarts, and polling resumes without resubmission. The provider's requested poll delay is respected. A request interrupted while submitting becomes **Check provider history**. It is never automatically retried because the provider may already have charged and accepted it. Check OpenArt/ElevenLabs history before requesting another render. Failed imports retain the provider history ID and any locally saved file for investigation. A creative change during a render prevents the stale result from being attached as a current take.

The conversation composer retains unsent text, attachments and its request ID in that browser. Retrying a request after a network failure uses the same ID to avoid duplicate messages. Saved conversation history is shared across your devices. ChatGPT credentials are never stored with browser drafts.

Approved-video upscaling continues to use the studio's existing upscale queue. Production chat does not claim an upscale was submitted unless that separate provider workflow has actually done so.

## Verification boundary

Automated tests use isolated MongoDB, locally signed test identities, mocked OAuth/model endpoints and mock OpenArt/ElevenLabs responses. They cover identity/PKCE/state validation, account isolation, renewal/revocation, ignored API keys, streaming limits, incomplete tool calls, approval gates and original-file imports without spending production credits. Browser QA uses visibly labeled test data and separate local HTTP/HTTPS fixture servers. Live ChatGPT plan eligibility, inference and actual paid-provider renders can only be verified after the owner signs in and grants the required permissions. The morning setup above is the remaining user action.

## Sound effects and local mixing

Studio chat can request an ElevenLabs effect using `request_sound_effect` with an approved scene's sound layer ID, or a zero-credit local mix using `request_sound_mix` with an original clip take. It reads current records before queueing and reports queued work separately from finished results. The owner edits and approves the sound plan on the episode page, approves or rejects each individual sound, then reviews and approves the mixed video. Chat cannot approve those choices. Raw renders remain available and never receive an automatic new video approval. See the [sound workflow](STUDIO-GUIDE.md#sound-design-and-finished-video-review).
