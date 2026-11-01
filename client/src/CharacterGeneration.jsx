import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import { addCharacterPackage } from '../../shared/character-package.js';
import { selectedImageReferences } from '../../shared/image-references.js';
import {
  imageReferencePromptBase,
  remapImageReferencePrompt,
  withImageReferencePrompt
} from '../../shared/reference-prompt.js';
import { request } from './api.js';
import ImageRequestReferences from './ImageRequestReferences.jsx';
import { studioUrl } from './project-url.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import {
  assetImageGenerationAnchor,
  assetReferenceSetupAnchor,
  focusSection,
  reviewHref
} from './review-navigation.js';
import { ReferencePreview } from './StudioMedia.jsx';

const running = (job) =>
  ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'].includes(
    job?.status
  );
export default function CharacterGeneration({
  asset,
  media = [],
  disabled,
  draftPending,
  onSaved,
  onReload,
  onRejected
}) {
  const base = '/studio/assistant/character-generation/' + asset._id;
  const draftKey = 'roxy-character-prompts-' + asset._id;
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey)) ?? {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(drafts));
    } catch {
      /* Keep this tab's draft. */
    }
  }, [draftKey, drafts]);
  useEffect(() => {
    let active = true;
    const load = () =>
      request(base)
        .then((next) => {
          if (active) {
            setData(next);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    void load();
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [base, asset.revision]);
  const imageAnchor = window.location.hash.slice(1);
  const requestedImageAnchor = data?.images?.some(
    (image) => assetImageGenerationAnchor(asset._id, image.itemId) === imageAnchor
  )
    ? imageAnchor
    : null;
  useEffect(() => {
    if (!requestedImageAnchor) return;
    const frame = requestAnimationFrame(() => focusSection(requestedImageAnchor));
    return () => cancelAnimationFrame(frame);
  }, [requestedImageAnchor]);
  const pendingJob = data?.jobs?.some(running);
  useEffect(() => {
    if (!pendingJob) return;
    let active = true;
    const timer = setInterval(() => {
      request(base)
        .then((next) => {
          if (active) {
            setData(next);
            if (!next.jobs.some(running)) onReload?.();
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base, pendingJob, onReload]);
  async function refresh() {
    const next = await request(base);
    setData(next);
    return next;
  }
  async function act(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const value = (key, fallback) => drafts[key] ?? fallback;
  const clear = (key) =>
    setDrafts((old) => {
      const next = { ...old };
      delete next[key];
      return next;
    });
  async function saveVoice() {
    const result = await request(base + '/voice', {
      method: 'PUT',
      body: {
        revision: data.asset.revision,
        voiceRevision: data.voice?.revision,
        prompt: value('voice', data.voicePrompt)
      }
    });
    clear('voice');
    if (asset.kind === 'voice') onSaved?.(result.voice);
    onReload?.();
    return refresh();
  }
  async function saveImage(itemId) {
    const image = data.images.find((item) => item.itemId === itemId);
    const result = await request('/studio/assets/' + asset._id, {
      method: 'PUT',
      body: {
        ...data.asset,
        production: {
          ...data.asset.production,
          items: data.asset.production.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  ...(value(itemId + ':references', image.imageReferences?.selected) !== undefined
                    ? {
                        imageReferenceMediaIds: value(
                          itemId + ':references',
                          image.imageReferences?.selected
                        )
                      }
                    : {}),
                  imagePrompt: imageReferencePromptBase(
                    value(itemId, image.promptBase ?? image.prompt)
                  )
                }
              : item
          )
        }
      }
    });
    clear(itemId);
    clear(itemId + ':references');
    onSaved?.(result.asset);
    onReload?.();
    return refresh();
  }
  async function generateVoice() {
    const current =
      !data.voice?.production?.voiceDescription?.trim() ||
      value('voice', data.voicePrompt) !== data.voicePrompt
        ? await saveVoice()
        : data;
    await request('/studio/assistant/voice/generate', {
      method: 'POST',
      body: {
        target: { assetId: current.voice._id },
        speaker: current.speaker,
        prompt: current.voicePrompt,
        requestId: crypto.randomUUID()
      }
    });
    setNotice('Voice auditions requested. They will appear here for listening and selection.');
    await refresh();
  }
  async function generateImage(itemId) {
    let current = data;
    let image = current.images.find((item) => item.itemId === itemId);
    if (
      value(itemId, image.promptBase ?? image.prompt) !== (image.promptBase ?? image.prompt) ||
      JSON.stringify(value(itemId + ':references', image.imageReferences?.selected)) !==
        JSON.stringify(image.imageReferences?.selected)
    ) {
      current = await saveImage(itemId);
      image = current.images.find((item) => item.itemId === itemId);
    }
    if (image.plan && image.plan.status !== 'approved') {
      const row = image.plan;
      await request('/studio/workflow/review', {
        method: 'POST',
        body: {
          target: row.target,
          stage: row.stage,
          action: 'approve',
          fingerprint: row.fingerprint,
          parentRevision: row.parentRevision,
          reviewRevision: row.reviewRevision,
          feedback: ''
        }
      });
    }
    await request('/studio/assistant/image/generate', {
      method: 'POST',
      body: {
        assetId: asset._id,
        revision: current.asset.revision,
        packageItemId: itemId,
        prompt: image.prompt,
        requestId: crypto.randomUUID()
      }
    });
    setNotice('One ' + image.title.toLowerCase() + ' image requested. Other views are unchanged.');
    await refresh();
    onReload?.();
  }
  if (!data)
    return error ? (
      <Alert severity="error">{error}</Alert>
    ) : (
      <Typography>Loading character generation prompts…</Typography>
    );
  const voiceDirty = value('voice', data.voicePrompt) !== data.voicePrompt;
  const locked = disabled || busy || draftPending;
  const voiceOptions = (data.voice?.candidates ?? []).filter((item) => !item.archived);
  return (
    <Stack
      className="editor-panel"
      spacing={3}
      component="section"
      aria-label="Character generation"
    >
      <Typography variant="h2">
        {asset.kind === 'voice' ? 'Voice generation' : 'Voice and image generation'}
      </Typography>
      <Typography>
        Review each complete prompt before generating. Saving prompts does not generate media. Voice
        and image requests are separate.
      </Typography>
      {data.characterSource && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {data.characterSource.status === 'approved' && (
            <Chip label="Character source evidence approved" color="success" size="small" />
          )}
          <Button
            component="a"
            href={reviewHref(
              { scope: 'asset', recordId: data.characterSource.assetId },
              'source',
              asset._id
            )}
          >
            {asset.kind === 'voice'
              ? 'View character source evidence'
              : 'Review saved source evidence'}
          </Button>
          {asset.kind === 'voice' && (
            <Button
              component="a"
              href={
                studioUrl('/?asset=' + data.characterSource.assetId) +
                '#' +
                assetImageGenerationAnchor(data.characterSource.assetId, 'body-turnaround')
              }
            >
              Open character images
            </Button>
          )}
          {asset.kind === 'voice' && (
            <Typography variant="body2">
              Visual evidence belongs to {data.characterSource.name}. This voice reference uses the
              voice prompt and your audition selection.
            </Typography>
          )}
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {draftPending && (
        <Alert severity="info">
          Save the character details above before saving or generating from these prompts. Your
          prompt edits stay in this browser.
        </Alert>
      )}
      <Stack spacing={1} component="section" aria-label="Character voice generation">
        <Typography variant="h3">Character voice</Typography>
        <TextField
          label="Voice generation prompt"
          disabled={busy || disabled}
          multiline
          minRows={4}
          maxRows={10}
          value={value('voice', data.voicePrompt)}
          onChange={(e) => setDrafts((old) => ({ ...old, voice: e.target.value }))}
          helperText={`${value('voice', data.voicePrompt).length}/1000 characters. Describe gender, vocal age, accent, pitch and delivery as appropriate.`}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        {voiceDirty && (
          <Alert
            severity="info"
            action={
              <Button color="inherit" onClick={() => clear('voice')}>
                Use saved voice prompt
              </Button>
            }
          >
            This field contains an unsaved local voice prompt. Generate will save and use the text
            shown here.
            <Box component="details" sx={{ mt: 1 }}>
              <Typography component="summary" sx={{ cursor: 'pointer' }}>
                View current saved voice prompt
              </Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{data.voicePrompt}</Typography>
            </Box>
          </Alert>
        )}
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button
            disabled={
              locked ||
              running(data.voiceJob) ||
              (!voiceDirty && Boolean(data.voice?.production?.voiceDescription?.trim())) ||
              !value('voice', data.voicePrompt).trim()
            }
            onClick={() =>
              act(async () => {
                await saveVoice();
                setNotice('Voice prompt saved. No auditions generated.');
              })
            }
          >
            Save voice prompt
          </Button>
          <Button
            variant="contained"
            disabled={locked || running(data.voiceJob) || !value('voice', data.voicePrompt).trim()}
            onClick={() => act(generateVoice)}
          >
            {voiceDirty ? 'Save prompt & generate voice auditions' : 'Generate voice auditions'}
          </Button>
          {data.voice && (
            <Button component="a" href={studioUrl('/?asset=' + data.voice._id)}>
              Open voice reference
            </Button>
          )}
          {data.voice?.finalChoice && (
            <Chip label="Approved voice retained" color="success" size="small" />
          )}
        </Stack>
        {data.jobs
          .filter((job) => job.kind === 'voice')
          .slice(0, 1)
          .map((job) => (
            <Alert
              key={job._id}
              severity={job.status === 'failed' || job.status === 'uncertain' ? 'warning' : 'info'}
            >
              {job.title}: {job.status}. {job.error}
            </Alert>
          ))}
        {voiceOptions.map((option) => (
          <Stack
            key={option.id}
            spacing={1}
            sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
          >
            <Typography fontWeight={600}>{option.title}</Typography>
            {(option.mediaIds ?? []).map((id) => {
              const file = media.find((item) => item._id === String(id));
              return file ? (
                <Box key={id}>
                  <ReferencePreview file={file} />
                  <RejectMediaButton
                    file={file}
                    context={{
                      assetId: data.voice._id,
                      revision: data.voice.revision,
                      candidateId: option.id
                    }}
                    disabled={locked}
                    onRejected={async (result) => {
                      await onRejected?.(result);
                      await refresh();
                    }}
                  />
                </Box>
              ) : null;
            })}
            <Button
              disabled={locked || voiceDirty || data.voice.finalChoice?.id === option.id}
              onClick={() =>
                act(async () => {
                  await request('/studio/assets/' + data.voice._id + '/finalize', {
                    method: 'POST',
                    body: { revision: data.voice.revision, candidateId: option.id }
                  });
                  await refresh();
                  onReload?.();
                  setNotice('Voice approved. Character images are unchanged.');
                })
              }
            >
              {data.voice.finalChoice?.id === option.id ? 'Approved voice' : 'Approve this voice'}
            </Button>
          </Stack>
        ))}
      </Stack>
      {asset.kind !== 'voice' && (
        <Stack spacing={2} component="section" aria-label="Character image generation">
          <Stack
            direction="row"
            sx={{ gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
          >
            <Typography variant="h3">Character images</Typography>
            {data.images.some((image) => image.itemId === 'body-turnaround') && (
              <Button
                component="a"
                href={'#' + assetImageGenerationAnchor(asset._id, 'body-turnaround')}
                onClick={() =>
                  focusSection(assetImageGenerationAnchor(asset._id, 'body-turnaround'))
                }
              >
                Jump to body turnaround
              </Button>
            )}
            <Button
              component="a"
              href={reviewHref({ scope: 'asset', recordId: asset._id }, 'brief', asset._id)}
            >
              Review creative brief
            </Button>
          </Stack>
          {addCharacterPackage(data.asset.production?.items).length >
            (data.asset.production?.items?.length ?? 0) && (
            <Button
              id={assetReferenceSetupAnchor(asset._id)}
              sx={{ scrollMarginTop: '110px' }}
              disabled={locked}
              onClick={() =>
                act(async () => {
                  const { asset: next } = await request('/studio/assets/' + asset._id, {
                    method: 'PUT',
                    body: {
                      ...data.asset,
                      production: {
                        ...data.asset.production,
                        items: addCharacterPackage(data.asset.production?.items)
                      }
                    }
                  });
                  onSaved?.(next);
                  await refresh();
                  onReload?.();
                  setNotice(
                    'Missing reference views and prompts added. Existing images are preserved; no images generated.'
                  );
                })
              }
            >
              {data.images.length ? 'Add remaining reference views' : 'Add image reference package'}
            </Button>
          )}
          {data.images.map((image) => {
            const prompt = imageReferencePromptBase(
                value(image.itemId, image.promptBase ?? image.prompt)
              ),
              imageReferences = selectedImageReferences(
                image.imageReferences,
                value(image.itemId + ':references', image.imageReferences?.selected ?? [])
              ),
              changed =
                prompt !== (image.promptBase ?? image.prompt) ||
                JSON.stringify(imageReferences?.selected) !==
                  JSON.stringify(image.imageReferences?.selected);
            return (
              <Stack
                key={image.itemId}
                component="section"
                id={assetImageGenerationAnchor(asset._id, image.itemId)}
                tabIndex={-1}
                aria-label={image.title + ' generation'}
                spacing={1}
                sx={{
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  scrollMarginTop: '110px'
                }}
              >
                <Typography variant="h3" component="h4" fontWeight={600}>
                  {image.title}
                </Typography>
                <TextField
                  label={image.title + ' image prompt'}
                  disabled={busy || disabled}
                  multiline
                  minRows={4}
                  maxRows={12}
                  value={prompt}
                  onChange={(e) => setDrafts((old) => ({ ...old, [image.itemId]: e.target.value }))}
                  helperText="Edit the directions for this image. The complete prompt below adds the attached reference roles. Save separately or generate this one image."
                  slotProps={{ htmlInput: { maxLength: 6000 } }}
                />
                <ImageRequestReferences
                  references={imageReferences}
                  media={media}
                  sceneDirty={changed}
                  onChangeReferences={
                    locked
                      ? undefined
                      : (ids) =>
                          setDrafts((old) => ({
                            ...old,
                            [image.itemId + ':references']: ids,
                            [image.itemId]: remapImageReferencePrompt(
                              prompt,
                              imageReferences.items,
                              ids
                            )
                          }))
                  }
                  onInsertReference={
                    locked
                      ? undefined
                      : (tag) =>
                          setDrafts((old) => ({ ...old, [image.itemId]: prompt + ' ' + tag + ' ' }))
                  }
                />
                <TextField
                  label={image.title + ' complete image prompt sent to OpenArt'}
                  value={withImageReferencePrompt(prompt, imageReferences?.items)}
                  multiline
                  minRows={3}
                  maxRows={10}
                  slotProps={{ input: { readOnly: true } }}
                />
                {image.blockers.length > 0 && (
                  <Alert
                    severity="info"
                    action={
                      image.blockers.some((reason) => /creative brief/i.test(reason)) ? (
                        <Button
                          component="a"
                          color="inherit"
                          href={reviewHref(
                            { scope: 'asset', recordId: asset._id },
                            'brief',
                            asset._id
                          )}
                        >
                          Review creative brief
                        </Button>
                      ) : undefined
                    }
                  >
                    {image.blockers.join(' ')}
                  </Alert>
                )}
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    disabled={locked || !changed || running(image.job) || !prompt.trim()}
                    onClick={() =>
                      act(async () => {
                        await saveImage(image.itemId);
                        setNotice(image.title + ' prompt saved. No image generated.');
                      })
                    }
                  >
                    Save {image.title.toLowerCase()} prompt
                  </Button>
                  <Button
                    variant="contained"
                    disabled={
                      locked || running(image.job) || image.blockers.length > 0 || !prompt.trim()
                    }
                    onClick={() => act(() => generateImage(image.itemId))}
                  >
                    {changed || (image.plan?.status !== 'approved' && image.plan)
                      ? 'Approve prompt & generate ' + image.title.toLowerCase()
                      : 'Generate ' + image.title.toLowerCase()}
                  </Button>
                  <Button
                    component="a"
                    href={reviewHref(
                      { scope: 'asset', recordId: asset._id },
                      'reference:' + image.itemId,
                      asset._id
                    )}
                  >
                    Review {image.title.toLowerCase()} image
                  </Button>
                </Stack>
                {image.job && (
                  <Alert
                    severity={
                      image.job.status === 'failed' || image.job.status === 'uncertain'
                        ? 'warning'
                        : 'info'
                    }
                  >
                    {image.job.title}: {image.job.status}. {image.job.error}
                  </Alert>
                )}
                {image.mediaId && (
                  <ReferencePreview
                    file={media.find((file) => file._id === String(image.mediaId))}
                  />
                )}
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
