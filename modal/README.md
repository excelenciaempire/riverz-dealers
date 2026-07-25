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

| `personaplex.py` | **PersonaPlex-7B** (NVIDIA full-duplex S2S) via `moshi.server` WebSocket | `wss://…/api/chat` | **plumbing shipped, NOT deployed** |

Deliberately NOT here (see research in the voice-ai-feature memory):
- **STT** → keep **Deepgram** streaming. LiveKit's OpenAI STT is batch (whole-utterance upload) and adds turn latency.

## Realtime (PersonaPlex) — plumbing shipped, dormant

Correction to the earlier note: PersonaPlex **is** usable via a **custom LiveKit model** — NVIDIA + LiveKit ship `livekit-plugins-nvidia[personaplex]` (a `RealtimeModel` that bridges LiveKit ↔ PersonaPlex's `moshi.server` binary WebSocket). We shipped the plumbing: `voice-worker/personaplex.py` (thin adapter), the router in `agent.py::_try_build_realtime`, and `modal/personaplex.py` (serves `moshi.server` on a GPU behind Modal's WebSocket — Modal supports long-lived WS: a WS = one function call up to `timeout`, not the 150s HTTP cap).

**Deploy (only when you decide to turn it on — it's expensive):**
```bash
modal profile activate riverztest2
modal secret create hf-token HF_TOKEN=hf_xxx    # HF acct that ACCEPTED the model license
modal deploy modal/personaplex.py               # → wss://<workspace>--personaplex.modal.run
```
Then /admin/voz → realtime mode + provider `personaplex` + base_url = that wss URL + a voice code (`NATF2`…).

**Two hard caveats (why it's dormant + gated, not the default):**
1. **No tool-calling.** Full-duplex S2S can't run `create_order`/`transfer_to_human`. The router auto-falls-back to the pipeline for any agent with `tools_enabled` — so PersonaPlex is only for tool-free conversational agents. No customer-side transcript in realtime mode either.
2. **Warm GPU is mandatory** (7B cold start too slow) → ~$1,400–2,850/mo baseline (L40S/A100/H100) regardless of volume, vs. the VoxCPM pipeline's L4 **scale-to-zero ($0 idle)**. Verdict: keep the pipeline as default; switch PersonaPlex on only for a specific tool-free use case where sub-250ms full-duplex is the selling point. Verify end-to-end SIP latency (24kHz model over 8kHz PSTN) before production.

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
