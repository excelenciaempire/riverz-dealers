"""Pruebas del saneador de texto hablado. `python voice-worker/test_speakable.py`"""

import asyncio

from speakable import speakable, speakable_stream

CASES = [
    # Lo que pasó en la llamada real: dictaba la URL entera.
    (
        "Te paso el link: https://j9kgap-kn.myshopify.com/products/serum-pilar",
        "Te paso el link: el link",
    ),
    ("Entrá a www.tienda.com/oferta y listo", "Entrá a el link y listo"),
    ("escribime a hola@tienda.com", "escribime a el link"),
    # Guiones entre dígitos: los deletreaba.
    ("Tu pedido es el 3870-9750", "Tu pedido es el 3870 9750"),
    ("+54 9 11 3870-9750", "+54 9 11 3870 9750"),
    # Guion largo = pausa, no la palabra "guion".
    ("Son tres cuotas — sin interés", "Son tres cuotas, sin interés"),
    ("Esperá... ya te lo mando", "Esperá. ya te lo mando"),
    # Markdown y emojis: el TTS los pronuncia.
    ("**Oferta** especial", "Oferta especial"),
    ("🚚 Envío gratis a todo el país", "Envío gratis a todo el país"),
    ("- Opción 1: *1 unidad*", "Opción 1: 1 unidad"),
    # Los precios NO se tocan.
    ("Son 39.990 pesos", "Son 39.990 pesos"),
    ("Te queda en 69.900 con envío gratis", "Te queda en 69.900 con envío gratis"),
    # Dos links seguidos se dicen una vez.
    ("Mirá https://a.com https://b.com", "Mirá el link"),
    # Texto normal intacto.
    ("¿Cuántas unidades te gustaría llevar?", "¿Cuántas unidades te gustaría llevar?"),
]


def test_speakable() -> int:
    fails = 0
    for src, want in CASES:
        got = speakable(src)
        if got != want:
            print(f"  FALLA  {src!r}\n     esperado: {want!r}\n     obtenido: {got!r}")
            fails += 1
    print(f"speakable: {len(CASES) - fails}/{len(CASES)} ok")
    return fails


def test_stream() -> int:
    """Un link partido entre trozos igual tiene que desaparecer."""
    fails = 0
    frase = "Te paso el link: https://tienda.com/serum-pilar y son 39.990 pesos."
    for size in (1, 3, 7, 20, 500):

        async def run(n=size):
            async def gen():
                for i in range(0, len(frase), n):
                    yield frase[i : i + n]

            return "".join([p async for p in speakable_stream(gen())])

        got = asyncio.run(run())
        if "https" in got or "tienda.com" in got:
            print(f"  FALLA  trozos de {size}: quedó la URL -> {got!r}")
            fails += 1
        elif "39.990" not in got:
            print(f"  FALLA  trozos de {size}: se perdió el precio -> {got!r}")
            fails += 1
    print(f"stream: {5 - fails}/5 tamaños de trozo ok")
    return fails


if __name__ == "__main__":
    total = test_speakable() + test_stream()
    print("TODO OK" if total == 0 else f"{total} FALLAS")
    raise SystemExit(1 if total else 0)
