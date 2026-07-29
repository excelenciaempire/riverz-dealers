"""Pruebas de la reescritura fonética rioplatense.

Se corren sin pytest: `python voice-worker/test_rioplatense.py`.
"""

import asyncio

from rioplatense import sheismo, sheismo_stream

CASES = [
    # Tabla del Step 8 de veo3-script-director
    ("cuello", "cuesho"),
    ("llevo", "shevo"),
    ("calle", "cashe"),
    ("yo", "sho"),
    ("ya", "sha"),
    ("yendo", "shendo"),
    ("mayoría", "mashoría"),
    ("incluyendo", "inclushendo"),
    ("vaya", "vasha"),
    # El ejemplo completo del skill
    (
        "Yo llegué ayer a la calle y me llamaron.",
        "Sho shegué asher a la cashe y me shamaron.",
    ),
    # Conjunción: SH ante vocal, se queda ante consonante
    ("y hay", "sh hay"),
    ("y sin", "y sin"),
    ("Y ahora", "Sh ahora"),
    # La `y` final NO es consonántica
    ("hoy", "hoy"),
    ("muy", "muy"),
    ("el rey", "el rey"),
    ("soy yo", "soy sho"),
    # Mayúsculas
    ("LLAMAR", "SHAMAR"),
    ("Llamar", "Shamar"),
    # No se toca lo que no es habla
    ("escribime a hola@calle.com", "escribime a hola@calle.com"),
    ("mirá https://tienda.com/calle-9", "mirá https://tienda.com/calle-9"),
    # Frase de una llamada real
    (
        "Ya salió tu pedido y llega el martes.",
        "Sha salió tu pedido y shega el martes.",
    ),
]


def test_sheismo() -> int:
    fails = 0
    for src, want in CASES:
        got = sheismo(src)
        if got != want:
            print(f"  FALLA  {src!r}\n     esperado: {want!r}\n     obtenido: {got!r}")
            fails += 1
    print(f"sheismo: {len(CASES) - fails}/{len(CASES)} ok")
    return fails


def test_stream() -> int:
    """El resultado por stream debe ser idéntico al de una sola pasada,
    aunque los trozos partan palabras al medio."""
    fails = 0
    frase = "Yo llegué ayer a la calle y me llamaron. Ya está y hay stock."
    esperado = sheismo(frase)

    for size in (1, 2, 3, 5, 7, 11, 100):
        async def run(n=size):
            chunks = [frase[i : i + n] for i in range(0, len(frase), n)]

            async def gen():
                for c in chunks:
                    yield c

            return "".join([p async for p in sheismo_stream(gen())])

        got = asyncio.run(run())
        if got != esperado:
            print(f"  FALLA  trozos de {size}\n     esperado: {esperado!r}\n     obtenido: {got!r}")
            fails += 1
    print(f"stream: {7 - fails}/7 tamaños de trozo ok")
    return fails


if __name__ == "__main__":
    total = test_sheismo() + test_stream()
    print("TODO OK" if total == 0 else f"{total} FALLAS")
    raise SystemExit(1 if total else 0)
