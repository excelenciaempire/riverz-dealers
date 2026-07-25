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
import threading
import time

import modal

APP_NAME = "personaplex"
MODEL_REPO = "nvidia/personaplex-7b-v1"
PORT = 8998
HF_CACHE = "/cache"
# Voz por defecto que se precarga al arrancar el contenedor para matar la
# latencia por-conexión (torch.load del voice prompt). moshi.server sólo
# recarga si la voz cambia (server.py:164), así que una vez cargada, todas las
# conexiones con esta voz conectan al instante — sin dead air al atender.
WARM_VOICE = "NATF2.pt"

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
    # PRODUCCIÓN (recepcionista/entrantes): GPU SIEMPRE caliente. Sin esto, el
    # arranque en frío del 7B (~12s) + carga de voz da dead air al atender.
    min_containers=1,
    # Ventana amplia de inactividad: mantené el contenedor (y la voz precargada
    # en memoria) vivo entre llamadas.
    scaledown_window=1800,
    timeout=86400,         # caps WS/call lifetime (max 24h). Lower to your max call length.
)
# max_inputs=1: moshi.server serializa el chat con un lock (server.py:114/259),
# así que 1 conversación por contenedor. Modal escala contenedores para
# concurrencia (cada uno se auto-calienta). Para más concurrencia sin cold start,
# subí min_containers / usá buffer_containers.
@modal.concurrent(max_inputs=1)
@modal.web_server(port=PORT, startup_timeout=600)  # proxy to moshi's own WS server on PORT
def serve():
    # No --ssl: Modal terminates TLS at the edge (clients use wss://, container speaks ws).
    subprocess.Popen(["python", "-m", "moshi.server", "--host", "0.0.0.0", "--port", str(PORT)])
    # Self-warm: precarga la voz por defecto (una conexión interna) para que la
    # PRIMERA llamada real ya la tenga cacheada y conecte al instante.
    threading.Thread(target=_warm, daemon=True).start()


def _warm() -> None:
    """Abre una conexión WS interna al arrancar para forzar la carga de la voz
    (torch.load) UNA vez; luego moshi la reusa (server.py:164) y las llamadas
    reales no pagan esa latencia."""
    import asyncio

    import aiohttp

    time.sleep(40)  # esperar a que el modelo termine de cargar (mimi+moshi+warmup)
    url = f"ws://localhost:{PORT}/api/chat?voice_prompt={WARM_VOICE}&text_prompt=hola"

    async def go() -> None:
        for attempt in range(8):
            try:
                async with aiohttp.ClientSession() as s:
                    async with s.ws_connect(url, max_msg_size=0) as ws:
                        # La PRIMERA conexión hace el torch.load de la voz + init
                        # perezosa (kernels CUDA): puede tardar bastante. Esperá
                        # con paciencia el handshake (\x00) — cuando llega, la voz
                        # quedó cacheada en lm_gen para todas las próximas.
                        first = await asyncio.wait_for(ws.receive(), timeout=150)
                        if first.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            raise RuntimeError(f"closed during warm: {first.type}")
                        # drená unos frames más para asegurar que arrancó el modelo
                        n = 1
                        end = time.time() + 8
                        while time.time() < end:
                            try:
                                m = await asyncio.wait_for(ws.receive(), timeout=6)
                            except asyncio.TimeoutError:
                                break
                            if m.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                break
                            n += 1
                        print(f"[warm] voice {WARM_VOICE} PRELOADED ok ({n} msgs)", flush=True)
                        return
            except Exception as e:  # noqa: BLE001
                print(f"[warm] attempt {attempt} failed: {type(e).__name__}: {e}", flush=True)
                time.sleep(8)
        print("[warm] GAVE UP — first call may pay the load latency", flush=True)

    try:
        asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        print(f"[warm] fatal: {type(e).__name__}: {e}", flush=True)
