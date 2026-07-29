"""Acento rioplatense: reescritura fonética para el TTS.

El TTS pronuncia LETRAS, no fonemas. La forma de conseguir el ʃeísmo porteño
(el sonido "sh" de `calle`, `yo`, `ayer`) es escribirlo así antes de mandarlo a
sintetizar: `cashe`, `sho`, `asher`. La técnica viene del skill
`veo3-script-director` (Step 8), donde se usa para el mismo fin con Veo 3.

Se aplica SÓLO en el borde del TTS, nunca antes: la transcripción que ve el
comercio en la bandeja y el resumen de la llamada siguen en español normal.
Escribir "sho shegué" en el CRM sería ilegible.

Reglas (tabla del Step 8):

    LL en cualquier posición  → SH    calle → cashe, llevo → shevo
    Y al inicio de palabra    → SH    yo → sho, ya → sha
    Y entre vocales           → SH    ayer → asher, vaya → vasha
    Y conjunción + vocal      → Sh    "y hay" → "sh hay"
    Y conjunción + consonante → (se queda)   "y sin" → "y sin"

La `y` final (`hoy`, `muy`, `rey`) NO es consonántica y no se toca: no cae en
ninguna de las reglas de arriba.
"""

from __future__ import annotations

import re
from typing import AsyncGenerator, AsyncIterable

_VOWELS = "aeiouáéíóúAEIOUÁÉÍÓÚ"

# "y" suelta seguida de palabra que EMPIEZA con vocal (la h es muda, así que
# "y hay" suena "sh ay"). Se resuelve primero, antes de tocar las otras `y`.
_CONJ_BEFORE_VOWEL = re.compile(rf"\b([yY])(\s+)(?=[hH]?[{_VOWELS}])")
_Y_WORD_START = re.compile(rf"\b([yY])(?=[{_VOWELS}])")
_Y_BETWEEN_VOWELS = re.compile(rf"(?<=[{_VOWELS}])([yY])(?=[{_VOWELS}])")

# No se toca lo que no es habla: URLs, emails y códigos. En una llamada el
# agente no suele leerlos, pero si lo hace, deformarlos lo haría inservible.
_NOT_SPEECH = re.compile(r"(https?://\S+|www\.\S+|\S+@\S+\.\S+)")


def _sh(match: re.Match, upper: str = "Sh", lower: str = "sh") -> str:
    return upper if match.group(1).isupper() else lower


def _apply(text: str) -> str:
    text = _CONJ_BEFORE_VOWEL.sub(lambda m: _sh(m) + m.group(2), text)
    text = text.replace("LL", "SH").replace("Ll", "Sh").replace("ll", "sh")
    text = _Y_WORD_START.sub(_sh, text)
    text = _Y_BETWEEN_VOWELS.sub(_sh, text)
    return text


def sheismo(text: str) -> str:
    """Reescribe el texto como suena en Buenos Aires, salteando URLs/emails."""
    if not text:
        return text
    out: list[str] = []
    last = 0
    for m in _NOT_SPEECH.finditer(text):
        out.append(_apply(text[last : m.start()]))
        out.append(m.group(0))  # tal cual
        last = m.end()
    out.append(_apply(text[last:]))
    return "".join(out)


async def sheismo_stream(text: AsyncIterable[str]) -> AsyncGenerator[str, None]:
    """Igual que `sheismo` pero sobre el stream de texto del LLM.

    El LLM emite trozos que parten palabras al medio ("ca" + "lle"): aplicar la
    regla trozo por trozo se comería justo los casos que importan. Así que se
    acumula y sólo se emite hasta el último espacio, dejando la palabra a medio
    escribir para la próxima vuelta. Además la `y` conjunción necesita ver la
    palabra SIGUIENTE, así que si la cola termina en una `y` suelta, se retiene.
    """
    buf = ""
    async for chunk in text:
        buf += chunk
        cut = max(buf.rfind(" "), buf.rfind("\n"))
        if cut < 0:
            continue
        head, tail = buf[: cut + 1], buf[cut + 1 :]
        # Retener la `y` final: sin la palabra que sigue no se sabe si va "sh".
        stripped = head.rstrip()
        if stripped.endswith(("y", "Y")) and (len(stripped) == 1 or stripped[-2].isspace()):
            keep = len(stripped) - 1
            head, tail = head[:keep], head[keep:] + tail
        if head:
            yield sheismo(head)
        buf = tail
    if buf:
        yield sheismo(buf)
