"""Cliente HTTP mínimo hacia el backend de Riverz (Next.js) — idéntico al que
usa voice-worker/ (LiveKit). El worker de voz es "tonto": toda la lógica de
negocio vive en el web app. Habla los 3 endpoints internos del contrato:

  GET  /api/internal/voice/context   -> configuración de la llamada
  POST /api/internal/voice/tool      -> ejecuta una tool y devuelve su result (string)
  POST /api/internal/voice/result    -> reporta el desenlace (idempotente por call_id)

Auth: header `Authorization: Bearer ${VOICE_WORKER_SECRET}` en cada request.
Timeouts + 1 reintento ante 5xx / error de red. Todo fail-soft.

NOTA: este archivo es una copia deliberada de voice-worker/riverz_api.py para
mantener los dos workers (LiveKit y Pipecat) desacoplados; comparten el MISMO
contrato interno y la MISMA base de datos, así que las llamadas hechas por
cualquiera de los dos aparecen igual en Riverz.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("riverz-pipecat.api")


class RiverzAPI:
    def __init__(
        self,
        base_url: str | None = None,
        secret: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = (base_url or os.getenv("RIVERZ_BASE_URL") or "").rstrip("/")
        self.secret = secret or os.getenv("VOICE_WORKER_SECRET") or ""
        if not self.base_url:
            logger.warning("RIVERZ_BASE_URL no está configurado; las llamadas al backend fallarán")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={
                "Authorization": f"Bearer {self.secret}",
                "Content-Type": "application/json",
            },
        )

    async def aclose(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """GET/POST con 1 reintento ante 5xx o error de transporte."""
        url = f"{self.base_url}{path}"
        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                resp = await self._client.request(method, url, params=params, json=json)
                if resp.status_code >= 500:
                    last_exc = httpx.HTTPStatusError(
                        f"HTTP {resp.status_code}", request=resp.request, response=resp
                    )
                    if attempt == 0:
                        await asyncio.sleep(0.5)
                        continue
                resp.raise_for_status()
                if not resp.content:
                    return {}
                return resp.json()
            except (httpx.TransportError, httpx.TimeoutException) as e:
                last_exc = e
                if attempt == 0:
                    await asyncio.sleep(0.5)
                    continue
                raise
        assert last_exc is not None
        raise last_exc

    # --- Endpoints del contrato ---

    async def get_context(
        self,
        *,
        call_id: str | None = None,
        did: str | None = None,
        caller: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, str] = {}
        if call_id:
            params["call_id"] = call_id
        if did:
            params["did"] = did
        if caller:
            params["caller"] = caller
        return await self._request("GET", "/api/internal/voice/context", params=params)

    async def run_tool(self, call_id: str, tool: str, input: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/api/internal/voice/tool",
            json={"call_id": call_id, "tool": tool, "input": input},
        )

    async def post_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/internal/voice/result", json=payload)
