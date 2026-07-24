# Riverz Voice — models on Modal

> **LIVE (test profile `riverztest2`):** VoxCPM TTS deployed at
> `https://riverztest2--voxcpm-tts.modal.run` — verified end to end (`/health` OK;
> `/v1/audio/speech` returns a valid WAV in ~3 s warm). The global voice config
> already points its TTS `base_url` here. **Two things remain:** (1) paste the
> `VOXCPM_API_KEY` (Modal secret `voxcpm-auth`) into **/admin/voz → TTS → API key**;
> (2) for production latency set `min_containers=1` (first call is a ~4 min GPU
> cold start otherwise). This is a scale-to-zero TEST deploy on `riverztest2`.

Self-hosted voice models served as **OpenAI-compatible** HTTP endpoints so the
LiveKit voice worker (`voice-worker/`) can point its `openai.*` plugins at them
via the global admin config (`/admin/voz`). Running models here (instead of the
built-in providers) cuts per-minute cost and enables brand voice cloning.

## What's here

| File | Serves | Endpoint | Status |
|---|---|---|---|
| `voxcpm_tts.py` | **VoxCPM 2B TTS** (OpenBMB, Apache-2.0) | `POST /v1/audio/speech` (OpenAI-compatible) | **shippable** |

Deliberately NOT here (see research in the voice-ai-feature memory):
- **STT** → keep **Deepgram** streaming. LiveKit's OpenAI STT is batch (whole-utterance upload) and adds turn latency.
- **Realtime / PersonaPlex** → not self-servable as an OpenAI-Realtime endpoint today (weights exist at `nvidia/personaplex-7b-v1`, but there's no OpenAI-Realtime-compatible server). Keep the STT→LLM→TTS pipeline; revisit if NVIDIA ships a NIM.

## Deploy (VoxCPM TTS)

```bash
modal profile activate riverztest2
# one-time: the bearer token the worker sends as api_key
modal secret create voxcpm-auth VOXCPM_API_KEY=sk-<random>
modal deploy modal/voxcpm_tts.py
# → https://<workspace>--voxcpm-tts.modal.run   (label pinned; stable)
```

GPU: **L4** (24 GB; VoxCPM needs ~8 GB). `min_containers=0` = scale to zero
(cheapest; cold start on first hit). For production low-latency set it to `1`
(keeps a warm GPU ~24/7, ~$19/day on L4). Weights are baked into a Volume at
build time so cold starts only pay model→GPU load (a few seconds).

## Wire into Riverz

In **/admin/voz** (platform admin), TTS layer:
- **Endpoint (Modal)** = `https://<workspace>--voxcpm-tts.modal.run/v1`  ← note the trailing `/v1`
- **API key** = the `VOXCPM_API_KEY` from the Modal secret (encrypted at rest by the app)
- Provider = anything non-`elevenlabs` (e.g. `openai`); Model = `voxcpm2` (ignored by the wrapper)

The worker then uses `openai.TTS(base_url=…/v1, api_key=…, response_format="wav")`
against this endpoint. `base_url` empty ⇒ falls back to the built-in ElevenLabs.

## Contract notes (why it works)

- LiveKit's OpenAI TTS plugin calls `POST {base_url}/audio/speech`, so `base_url`
  ends in `/v1` and the route is `/v1/audio/speech`. It decodes based on the
  `response_format` it **requested** (not the Content-Type). The worker requests
  `wav` (self-describing; LiveKit resamples). The wrapper returns real WAV for
  `wav` and raw 24 kHz s16le for `pcm` (lower latency, optional).
- Auth is an in-app `Authorization: Bearer` check (NOT Modal Proxy Auth), because
  the OpenAI SDK only sends `Authorization: Bearer`.
