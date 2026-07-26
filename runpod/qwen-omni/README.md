# Qwen-Omni voice server (spike self-host)

Full-duplex/turn-based speech-to-speech **multilingüe** (habla español) para
Riverz, self-host en **RunPod**. Alternativa a PersonaPlex (que es solo inglés)
y a Gemini Live/OpenAI Realtime (hosteados, pago por minuto).

Modelo: **Qwen/Qwen2.5-Omni-7B** (Apache-2.0). Escucha audio y responde con voz
propia. ~24GB VRAM en bf16 → entra en una **RTX 4090** o **L40S**.

## Qué incluye
- `server.py` — FastAPI: `/health`, `POST /v1/omni/turn` (audio→audio+texto),
  `WS /v1/omni/stream` (streaming turn-based).
- `Dockerfile` — CUDA 12.1 + PyTorch + transformers + flash-attn.
- `test_client.py` — prueba de humo (manda un WAV, guarda la respuesta + latencia).
- `requirements.txt`.

## Deploy en RunPod (Pod dedicado — recomendado para producción)
1. Subí esta carpeta a un repo o construí la imagen:
   ```bash
   docker build -t <tu-registry>/qwen-omni:latest runpod/qwen-omni
   docker push <tu-registry>/qwen-omni:latest
   ```
   (o usá el GitHub integration de RunPod apuntando a `runpod/qwen-omni`).
2. RunPod → **Pods → Deploy** → GPU **RTX 4090 (Community, ~$0.34/hr)** o
   **L40S 48GB (~$0.79/hr)** si querés holgura/concurrencia.
3. Imagen: la que pusheaste. Puerto expuesto: **8000** (HTTP).
4. Env vars:
   - `OMNI_AUTH_TOKEN` = un secreto tuyo (para proteger el endpoint).
   - `OMNI_VOICE` = `Chelsie` (o `Ethan`).
   - `OMNI_PRELOAD=1` (baja pesos al arrancar → sin cold start en la 1ª llamada).
   - `ATTN_IMPL=sdpa` solo si flash-attn no compiló.
5. **Network Volume** (recomendado): montá uno en `/root/.cache/huggingface` para
   que los pesos (~16GB) se bajen una vez y no en cada arranque. Storage ~$0.10/GB/mes.
6. Tomá la URL pública del pod (`https://<pod-id>-8000.proxy.runpod.net`).

### Serverless (para probar barato, con cold start)
RunPod → Serverless → misma imagen, GPU **L4 24GB (~$0.69/hr)**, scale-to-zero.
Aceptás segundos de cold start al inicio; ideal para experimentar.

## Probar
```bash
pip install requests soundfile librosa
python test_client.py --url https://<pod-id>-8000.proxy.runpod.net \
  --audio pregunta.wav --token <OMNI_AUTH_TOKEN> \
  --system "Eres asesora del Serum de Pilar. Responde en español, breve."
```
Deberías obtener `respuesta.wav` + la latencia del server. Con eso validás el
modelo y el costo/latencia real ANTES de integrarlo.

## Integración con el voice-worker (paso 2)
El worker de Riverz (LiveKit) ya reconoce el provider `qwen_omni` en
`voice-worker/agent.py::_try_build_realtime`, pero **por ahora cae al pipeline**
(Cerebras+Celeste) porque falta el *adapter* LiveKit ↔ este server.

El server es **turn-based** (el cliente marca fin de turno vía `commit` en el WS),
así que NO habla el protocolo OpenAI-Realtime. El adapter (a escribir en
`voice-worker/qwen_omni.py`, siguiendo el patrón de `personaplex.py`) debe:
1. Abrir el WS `/v1/omni/stream`, mandar `{system, token}`.
2. Enviar los frames PCM16 16kHz del usuario que le pasa LiveKit.
3. Al detectar fin de turno (VAD de LiveKit) mandar `"commit"` y recibir
   texto + WAV 24kHz → publicarlo como salida de audio del agente.
4. Exponer `transcript` para persistir la conversación.

Esto requiere GPU en el loop para afinar latencia/turn-taking (por eso es paso 2).
El barge-in full-duplex real (pisar al bot) es un paso 3 sobre el mismo server.

## Costo (referencia)
- RTX 4090 dedicado: ~$0.34/hr → **~$248/mes** 24/7, minutos ilimitados, sin cold start.
- Break-even vs Gemini Live/OpenAI Realtime (~$0.10-0.30/min): a partir de
  **~1.000-2.500 min/mes** de llamadas conviene self-host. Por debajo, hosteado.
- Cada GPU ≈ 1 llamada simultánea (S2S con estado); más concurrencia = más GPUs.

## Recomendación
Usá este spike para **medir** latencia/calidad de Qwen-Omni en español y el costo
real. Si convence y tenés volumen, se termina el adapter LiveKit. Mientras tanto,
para full-duplex sin infra: **Gemini Live** (activable pegando `GEMINI_API_KEY`).
