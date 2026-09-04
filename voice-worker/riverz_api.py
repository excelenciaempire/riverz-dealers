"""Cliente HTTP mínimo hacia el backend de Riverz (Next.js).

El worker de voz es "tonto": toda la lógica de negocio vive en el web app.
Este cliente sólo habla los 3 endpoints internos del contrato:

  GET  /api/internal/voice/context   -> configuración de la llamada
  POST /api/internal/voice/tool      -> ejecuta una tool y devuelve su result (string)
  POST /api/internal/voice/result    -> reporta el desenlace (idempotente por call_id)

Auth: header `Authorization: Bearer ${VOICE_WORKER_SECRET}` en cada request.
Timeouts + 1 reintento ante 5xx / error de red. Todo fail-soft.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("riverz-voice.api")


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
        # Un único AsyncClient reutilizado durante toda la llamada.
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
        for attempt in range(2):  # intento inicial + 1 reintento
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
        # Sólo se llega aquí si el último intento fue un 5xx no relanzado.
        assert last_exc is not None
        raise last_exc

    # --- Endpoints del contrato ---

    async def get_context(
        self,
        *,
        call_id: str | None = None,
        did: str | None = None,
        caller: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Trae la config de la llamada. Llamar UNA vez cerca del inicio:
        marca la llamada como dialing/in_progress en el servidor."""
        params: dict[str, str] = {}
        if call_id:
            params["call_id"] = call_id
        if did:
            params["did"] = did
        if caller:
            params["caller"] = caller
        if session_id:
            params["session_id"] = session_id
        return await self._request("GET", "/api/internal/voice/context", params=params)

    async def run_tool(self, call_id: str, tool: str, input: dict[str, Any]) -> dict[str, Any]:
        """Ejecuta una tool en el backend. Devuelve {"ok":true,"result":"<string>"}
        o {"ok":false,"error":"..."}. El backend valida el input."""
        return await self._request(
            "POST",
            "/api/internal/voice/tool",
            json={"call_id": call_id, "tool": tool, "input": input},
        )

    async def post_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Reporta el desenlace de la llamada. Idempotente por call_id en el servidor."""
        return await self._request("POST", "/api/internal/voice/result", json=payload)
