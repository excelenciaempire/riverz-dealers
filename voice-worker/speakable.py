"""Deja el texto en algo que se pueda DECIR en voz alta.

El LLM escribe para leer: links, guiones, asteriscos, emojis. El TTS no
interpreta nada de eso, lo pronuncia. En una llamada real el agente dijo la URL
del checkout letra por letra —"hache te te pe ese dos puntos barra barra"— y
deletreó los guiones de un teléfono. Suena a robot y encima es inútil: nadie
anota una URL de memoria por teléfono.

Se aplica en el borde del TTS, igual que `rioplatense`: la transcripción de la
bandeja conserva el link entero para que el comercio lo vea.

El prompt ya le pide al agente que no dicte links y que los mande por WhatsApp;
esto es la red de abajo para cuando igual lo intente.
"""

from __future__ import annotations

import re

# Un link, en cualquiera de sus formas.
_URL = re.compile(
    r"""(?ix)
    \b(
        https?://\S+          # http(s)://...
      | www\.\S+              # www....
      | [a-z0-9][a-z0-9\-]*\.(?:com|ar|co|mx|cl|es|io|app|shop|net|org|link)
        (?:\.[a-z]{2})?(?:/\S*)?
    )
    """
)

_EMAIL = re.compile(r"\b\S+@\S+\.\S+\b")

# Markdown y adornos que el TTS lee como símbolos o que le cortan la frase.
_MARKDOWN = re.compile(r"[*_`#>|~\[\]]+")
_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF←-⇿⬀-⯿]+"
)

# Guion ENTRE dígitos: es un separador visual (teléfonos, códigos, rangos). El
# TTS lo pronuncia "guion". Un espacio hace que lea los dos grupos seguidos.
_DASH_BETWEEN_DIGITS = re.compile(r"(?<=\d)\s*[-–—]\s*(?=\d)")
# Guion largo suelto: pausa, o sea coma.
_LONG_DASH = re.compile(r"\s*[–—]\s*")
_ELLIPSIS = re.compile(r"\.{3,}|…")
# Viñeta al principio de la línea. Sólo ahí: un guion dentro de una palabra
# ("dos-en-uno") es parte de la palabra y se respeta.
_BULLET = re.compile(r"(?m)^[ \t]*[-•·*]+[ \t]+")
_MULTISPACE = re.compile(r"[ \t]{2,}")

_LINK_WORD = {"es": "el link", "en": "the link"}


def speakable(text: str, lang: str = "es") -> str:
    """Reescribe `text` para que suene bien dicho en voz alta."""
    if not text:
        return text
    link = _LINK_WORD.get(lang, _LINK_WORD["es"])
    out = _EMAIL.sub(link, text)
    out = _URL.sub(link, out)
    out = _BULLET.sub("", out)
    out = _EMOJI.sub(" ", out)
    out = _MARKDOWN.sub("", out)
    out = _DASH_BETWEEN_DIGITS.sub(" ", out)
    out = _LONG_DASH.sub(", ", out)
    out = _ELLIPSIS.sub(".", out)
    out = _MULTISPACE.sub(" ", out)
    # Un "el link el link" queda de dos links seguidos; se dice una sola vez.
    out = re.sub(rf"(?:{re.escape(link)})(?:[ ,]+{re.escape(link)})+", link, out)
    return out.strip()


async def speakable_stream(text, lang: str = "es"):
    """Versión stream. Igual que en `rioplatense`: se acumula y se corta en el
    último espacio, porque un link partido entre dos trozos no se reconocería."""
    buf = ""
    async for chunk in text:
        buf += chunk
        cut = max(buf.rfind(" "), buf.rfind("\n"))
        if cut < 0:
            continue
        head, buf = buf[: cut + 1], buf[cut + 1 :]
        if head:
            # Se preserva el espacio final: es el que separa las palabras al
            # volver a pegar los trozos.
            yield speakable(head, lang) + " "
    if buf:
        yield speakable(buf, lang)
