"""PersonaPlex-7B (NVIDIA full-duplex speech-to-speech) served on Modal as a
public WebSocket, for the Riverz voice worker's realtime mode.

Runs NVIDIA's reference `moshi.server` (PersonaPlex fork of Kyutai Moshi) on a
GPU and exposes its WebSocket (path /api/chat). The worker's PersonaPlex
RealtimeModel (voice-worker/personaplex.py) connects to:
    wss://<workspace>--personaplex.modal.run

NOT DEPLOYED by default — this is expensive (a WARM GPU is mandatory; a 7B cold
start is too slow for inbound calls) and requires an HF token that has ACCEPTED
the model license. Deploy only when you decide to turn on realtime/PersonaPlex:

  modal profile activate riverztest2
  modal secret create hf-token HF_TOKEN=hf_xxx        # HF acct that accepted the license
  modal deploy modal/personaplex.py

Then in /admin/voz set realtime mode + provider "personaplex" + base_url to the
printed wss URL + a voice code (NATF2 …). The tools gate keeps tool-using agents
on the pipeline automatically.

Cost (Modal pricing, warm 24/7): A100-80GB ≈ $1,800/mo · H100 ≈ $2,845/mo ·
L40S ≈ $1,405/mo (cheapest; verify realtime latency, it's Ada not A100/H100).
Contrast: the VoxCPM TTS pipeline runs on L4 scale-to-zero ($0 idle).

WebSocket viability (verified): a WS connection == one Modal function call and
lives up to `timeout` (max 24h), NOT the 150s HTTP cap. First WS msg must arrive
<5s after the container is ready; messages <=2 MiB (Opus frames are a few KB).
"""
import subprocess

import modal

APP_NAME = "personaplex"
MODEL_REPO = "nvidia/personaplex-7b-v1"
PORT = 8998
HF_CACHE = "/cache"

cache_vol = modal.Volume.from_name("personaplex-cache", create_if_missing=True)
hf_secret = modal.Secret.from_name("hf-token")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libopus-dev", "ffmpeg")
    .run_commands(
        "git clone https://github.com/NVIDIA/personaplex /opt/personaplex",
        "pip install /opt/personaplex/moshi",
        "pip install accelerate huggingface_hub",
    )
    .env({"HF_HOME": HF_CACHE})
)


def _download():
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_REPO)  # gated: needs HF_TOKEN with the license accepted


# Bake gated weights into the Volume at build time so cold starts don't re-download.
image = image.run_function(_download, volumes={HF_CACHE: cache_vol}, secrets=[hf_secret])

app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu="A100-80GB",       # NVIDIA-tested HW. H100 = lowest latency; L40S = cheapest (verify).
    volumes={HF_CACHE: cache_vol},
    secrets=[hf_secret],
    # TEST/validation: scale-to-zero (pay per use; first call = slow cold start).
    # PRODUCTION: set min_containers=1 (warm GPU, ~$1.8k/mo) — 7B cold start is
    # too slow for inbound calls.
    min_containers=0,
    scaledown_window=300,
    timeout=86400,         # caps WS/call lifetime (max 24h). Lower to your max call length.
)
@modal.concurrent(max_inputs=2)                    # concurrent conversations/GPU (verify VRAM+latency)
@modal.web_server(port=PORT, startup_timeout=600)  # proxy to moshi's own WS server on PORT
def serve():
    # No --ssl: Modal terminates TLS at the edge (clients use wss://, container speaks ws).
    # MUST bind 0.0.0.0. Verify the flag names against the fork's moshi/server.py argparse
    # (Kyutai uses --host/--port); adjust if the PersonaPlex fork differs.
    subprocess.Popen(["python", "-m", "moshi.server", "--host", "0.0.0.0", "--port", str(PORT)])
