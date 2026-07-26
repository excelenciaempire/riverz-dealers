"""
Prueba de humo del endpoint Qwen-Omni desplegado en RunPod.

Manda un WAV (voz del "cliente") a /v1/omni/turn y guarda la respuesta de audio.
Sirve para validar que el Pod responde y medir latencia ANTES de cablearlo al
worker de LiveKit.

Uso:
  python test_client.py --url https://<pod>-8000.proxy.runpod.net \\
      --audio pregunta.wav --token <OMNI_AUTH_TOKEN> \\
      --system "Eres asesora del Serum de Pilar. Responde en español."

Requiere: pip install requests soundfile librosa
"""
import argparse
import base64
import time

import librosa
import numpy as np
import requests
import soundfile as sf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="base URL del pod (sin / final)")
    ap.add_argument("--audio", required=True, help="WAV de entrada (voz del cliente)")
    ap.add_argument("--token", default="", help="OMNI_AUTH_TOKEN si el server lo exige")
    ap.add_argument("--system", default="Eres un asistente de voz. Responde en español, breve.")
    ap.add_argument("--out", default="respuesta.wav")
    args = ap.parse_args()

    # Carga y resamplea a 16 kHz mono PCM16 (lo que espera el server).
    audio, _ = librosa.load(args.audio, sr=16000, mono=True)
    pcm16 = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()

    headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
    t0 = time.time()
    r = requests.post(
        f"{args.url}/v1/omni/turn",
        json={"system": args.system, "audio_b64": base64.b64encode(pcm16).decode()},
        headers=headers,
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    dt = int((time.time() - t0) * 1000)

    audio_bytes = base64.b64decode(data["audio_b64"])
    with open(args.out, "wb") as f:
        f.write(audio_bytes)

    print(f"texto del bot: {data['text']!r}")
    print(f"audio guardado en {args.out} ({data.get('sample_rate')} Hz)")
    print(f"latencia server: {data.get('ms')} ms | round-trip total: {dt} ms")


if __name__ == "__main__":
    main()
