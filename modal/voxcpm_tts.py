"""
VoxCPM 2B (OpenBMB) served on Modal as an OpenAI-compatible /v1/audio/speech
endpoint for the Riverz voice worker's `openai.TTS(base_url=..., api_key=...)`.

This is the "run the models on Modal" path: the platform admin points the
global voice TTS layer at this endpoint (base_url ends in /v1) and the LiveKit
worker uses the OpenAI-compatible plugin against it.

Deploy:
  modal profile activate riverztest2
  modal secret create voxcpm-auth VOXCPM_API_KEY=sk-<random>
  modal deploy modal/voxcpm_tts.py
  # → https://<workspace>--voxcpm-tts.modal.run   (label pinned below)

Wire (admin /admin/voz → TTS layer):
  base_url  = https://<workspace>--voxcpm-tts.modal.run/v1
  api_key   = <VOXCPM_API_KEY>          (same value as the Modal secret)
  provider  = openai   (any non-elevenlabs value; the worker uses the openai plugin when base_url is set)
  model     = voxcpm2  (arbitrary; the wrapper ignores it)

Notes:
- The LiveKit openai TTS emitter is fixed at 24000 Hz and keys the decode off
  the response_format the CLIENT requested. The worker requests "wav" (safe,
  self-describing; LiveKit resamples). This wrapper returns real WAV for "wav".
- Apache-2.0 model, ~8 GB VRAM. L4 is the sweet spot.
- min_containers=0 = scale to zero (pay per use, cold start on first hit).
  For production low-latency, bump to 1 (keeps a warm GPU ~24/7).
"""

import io
import os

import modal

APP_NAME = "voxcpm-tts"
MODEL_REPO = "openbmb/VoxCPM2"  # 2B, Apache-2.0, 48kHz out
HF_CACHE = "/cache"
TARGET_SR = 24000  # MUST match the LiveKit openai plugin's fixed SAMPLE_RATE

cache_vol = modal.Volume.from_name("voxcpm-cache", create_if_missing=True)
auth_secret = modal.Secret.from_name("voxcpm-auth")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "voxcpm",
        "soundfile",
        "scipy",
        "numpy",
        "huggingface_hub",
        "fastapi[standard]",
    )
    .env({"HF_HOME": HF_CACHE})
)


def _download():
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_REPO)


# Bake weights into the Volume at build time so cold starts don't re-download.
image = image.run_function(_download, volumes={HF_CACHE: cache_vol})

app = modal.App(APP_NAME)


@app.cls(
    image=image,
    gpu="L4",
    volumes={HF_CACHE: cache_vol},
    secrets=[auth_secret],
    min_containers=0,       # scale to zero (cost-first). Set 1 for warm/low-latency.
    scaledown_window=300,   # stay warm 5 min after last request
    timeout=600,
)
@modal.concurrent(max_inputs=4)
class VoxCPMServer:
    @modal.enter()
    def load(self):
        from voxcpm import VoxCPM

        self.model = VoxCPM.from_pretrained(MODEL_REPO, load_denoiser=False)
        self.native_sr = self.model.tts_model.sample_rate  # 48000

    @modal.asgi_app(label="voxcpm-tts")
    def serve(self):
        import numpy as np
        from fastapi import FastAPI, Header, HTTPException, Request
        from fastapi.responses import Response, StreamingResponse
        from scipy.signal import resample_poly

        web = FastAPI()
        API_KEY = os.environ["VOXCPM_API_KEY"]

        # Optional zero-shot cloning: map an OpenAI `voice` string → a reference
        # clip baked into the image (add .add_local_dir("voices","/voices")).
        VOICE_MAP: dict[str, dict] = {}

        def check_auth(authorization: str | None):
            if not authorization or not authorization.startswith("Bearer "):
                raise HTTPException(401, "missing bearer token")
            if authorization.split(" ", 1)[1] != API_KEY:
                raise HTTPException(401, "invalid token")

        def to_pcm16_24k(chunk_f32) -> bytes:
            x = np.asarray(chunk_f32, dtype="float32").reshape(-1)
            if self.native_sr != TARGET_SR:
                x = resample_poly(x, TARGET_SR, self.native_sr)
            x = np.clip(x, -1.0, 1.0)
            return (x * 32767.0).astype("<i2").tobytes()

        def gen_kwargs(body: dict) -> dict:
            kw = dict(text=body.get("input") or "", cfg_value=2.0, inference_timesteps=10)
            ref = VOICE_MAP.get(body.get("voice"))
            if ref:
                kw["prompt_wav_path"] = ref["wav"]
                kw["prompt_text"] = ref["text"]
            return kw

        @web.post("/v1/audio/speech")
        async def speech(request: Request, authorization: str | None = Header(default=None)):
            check_auth(authorization)
            body = await request.json()
            if not (body.get("input") or "").strip():
                raise HTTPException(400, "empty input")
            # Default to wav (foolproof): the worker requests wav explicitly.
            fmt = (body.get("response_format") or "wav").lower()
            kw = gen_kwargs(body)

            if fmt == "pcm":
                def stream():
                    for chunk in self.model.generate_streaming(**kw):
                        yield to_pcm16_24k(chunk)

                return StreamingResponse(stream(), media_type="audio/pcm")

            import soundfile as sf

            wav = np.asarray(self.model.generate(**kw), dtype="float32")
            buf = io.BytesIO()
            if fmt == "flac":
                sf.write(buf, wav, self.native_sr, format="FLAC")
                return Response(buf.getvalue(), media_type="audio/flac")
            # wav (and any unknown → wav, always safe)
            sf.write(buf, wav, self.native_sr, format="WAV", subtype="PCM_16")
            return Response(buf.getvalue(), media_type="audio/wav")

        @web.get("/health")
        def health():
            return {"ok": True}

        return web
