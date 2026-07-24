# Riverz Voice Worker

Agente telefónico de Riverz sobre **LiveKit Agents (Python v1.x)**. Hace llamadas
**salientes** y atiende **entrantes** a través de un trunk **SIP de Telnyx**
conectado a **LiveKit Cloud**.

El worker no tiene lógica de negocio: la trae del web app (Next.js) por HTTP y le
reporta el resultado. Pipeline **STT → LLM → TTS** (no speech-to-speech):

- **STT**: Deepgram (`nova-3`, `language=multi`)
- **LLM**: Anthropic (`claude-haiku-4-5`, prompt caching `ephemeral`)
- **TTS**: ElevenLabs (`eleven_flash_v2_5`)
- **Turn detection**: `MultilingualModel` · **VAD**: silero

Nombre de agente para dispatch: **`riverz-voice`**.

Ejemplo de referencia: <https://github.com/livekit-examples/outbound-caller-python>

---

## Estructura

| Archivo          | Rol |
|------------------|-----|
| `agent.py`       | Entrypoint, `WorkerOptions(agent_name="riverz-voice")`, `cli.run_app`, salientes/entrantes, timeout, transcript, resultado. |
| `riverz_api.py`  | Cliente HTTP async hacia `/api/internal/voice/*` (Bearer, timeouts, 1 reintento). |
| `tools.py`       | Fábrica de function tools (proxy a `/voice/tool`) + tools de control. |
| `requirements.txt` · `Dockerfile` · `.env.example` | Dependencias / imagen / variables. |

---

## Correr en local

```bash
cd voice-worker
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python agent.py download-files      # baja pesos de VAD + turn-detector (una vez)

cp .env.example .env                # completa las claves
python agent.py dev                 # hot-reload + logs de color
```

`python agent.py start` es el modo producción (logs JSON). El worker se registra en
LiveKit Cloud y queda esperando dispatch (salientes) y entrantes por dispatch rule.

Variables: ver [`.env.example`](./.env.example) — LiveKit, Anthropic, Deepgram,
ElevenLabs, `RIVERZ_BASE_URL` y `VOICE_WORKER_SECRET`.

---

## Despliegue (Render · Background Worker · Docker)

Servicio **Background Worker** (no Web Service: no expone puerto; abre WebSocket
saliente a LiveKit Cloud).

- **Runtime**: Docker, usando el `Dockerfile` de esta carpeta (`RUN python agent.py
  download-files` hornea los modelos en la imagen).
- **Start command**: el `CMD` ya es `python agent.py start`.
- **Env vars**: las mismas de `.env.example` en el dashboard de Render.
- **Escala**: cada instancia atiende varias llamadas concurrentes; sube réplicas
  según volumen.

---

## Contrato de dispatch (lo implementa el lado Next.js)

Base URL `${RIVERZ_BASE_URL}`, header `Authorization: Bearer ${VOICE_WORKER_SECRET}`.

1. **GET `/api/internal/voice/context`** — trae la config y marca la llamada como
   dialing/in_progress. Saliente: `?call_id=<uuid>` (leído del metadata de sala
   `{"call_id","workspace_id"}`). Entrante: `?did=<E164>&caller=<E164>` (derivados de
   los atributos SIP `sip.trunkPhoneNumber` y `sip.phoneNumber`).
2. **POST `/api/internal/voice/tool`** — `{call_id, tool, input}` → `{ok, result}`.
   Cada tool en `tools_enabled` reenvía aquí y devuelve `result` (string) al LLM.
3. **POST `/api/internal/voice/result`** — se llama una vez en el shutdown (o si el
   marcado falla). Idempotente por `call_id`. Incluye status, outcome, resumen,
   transcript, tiempos y uso.

**Tools de control** (siempre presentes): `report_outcome` (obligatoria antes de
colgar), `end_call`, `customer_requests_no_more_calls` (→ `opt_out`),
`detected_answering_machine` (→ status `voicemail`).

### Supuestos que el lado Next.js debe respetar

- **Salientes**: el metadata (de sala y/o de dispatch) es JSON `{"call_id","workspace_id"}`
  con `call_id` presente. Su presencia es lo que hace que el worker trate el job como
  saliente (si no hay `call_id`, se asume entrante).
- **`context.sip`** para salientes: `{trunk_id, caller_number}`. `caller_number` fija el
  caller ID (campo `sip_number`); si es `null` se usa el número configurado en el trunk.
- **`context.voice.voice_id`** (ElevenLabs) y **`context.llm.model`** (Anthropic) se pasan
  tal cual a los plugins; el TTS usa siempre `eleven_flash_v2_5`.
- `result` de `/voice/tool` debe ser un **string** (JSON serializado) apto para
  devolver al modelo verbatim.
- El **resumen** puede llegar `null` (p.ej. si Anthropic no tiene saldo); el backend
  no debe asumir que siempre viene.

---

## Configurar LiveKit + Telnyx (CLI `lk`)

Requiere el CLI `lk` autenticado contra tu proyecto (`lk cloud auth`). En Telnyx:
crea un **SIP Connection (FQDN/credentials)**, apunta el trunk saliente a
`sip.telnyx.com` y asocia tu número (DID) al inbound.

### 1) Trunk saliente (para marcar)

`outbound-trunk.json`:

```json
{
  "trunk": {
    "name": "Riverz outbound (Telnyx)",
    "address": "sip.telnyx.com",
    "numbers": ["+57XXXXXXXXXX"],
    "authUsername": "<telnyx-sip-user>",
    "authPassword": "<telnyx-sip-pass>"
  }
}
```

```bash
lk sip outbound create outbound-trunk.json
# → devuelve el trunk_id (ST_xxx). Este es el `context.sip.trunk_id` de las salientes.
```

### 2) Trunk entrante (para atender)

`inbound-trunk.json`:

```json
{
  "trunk": {
    "name": "Riverz inbound (Telnyx)",
    "numbers": ["+57XXXXXXXXXX"]
  }
}
```

```bash
lk sip inbound create inbound-trunk.json
```

### 3) Dispatch rule entrante → agente `riverz-voice`

`dispatch-rule.json`:

```json
{
  "dispatch_rule": {
    "name": "Riverz inbound → riverz-voice",
    "trunk_ids": [],
    "rule": { "dispatchRuleIndividual": { "roomPrefix": "call-" } },
    "roomConfig": {
      "agents": [{ "agentName": "riverz-voice" }]
    }
  }
}
```

```bash
lk sip dispatch create dispatch-rule.json
# Cada llamada entrante crea una sala "call-*" y despacha el agente riverz-voice.
```

### 4) Lanzar una llamada saliente (dispatch explícito)

```bash
lk dispatch create \
  --new-room \
  --agent-name riverz-voice \
  --metadata '{"call_id":"<uuid>","workspace_id":"<uuid>"}'
```

En producción el web app crea la sala con ese metadata y hace el dispatch por API;
el worker lee `call_id`, llama a `/voice/context`, y marca vía
`create_sip_participant` (`wait_until_answered=true`) usando `context.sip`.
