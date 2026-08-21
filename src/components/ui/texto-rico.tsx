'use client'

import { Fragment, type ReactNode } from 'react'

/**
 * Texto de un modelo, con el formato puesto.
 *
 * **El formato no es un adorno.** Los modelos escriben en Markdown —negritas
 * para una cifra o para el nombre de lo que acaban de crear, viñetas para
 * enumerar— porque así escriben para todos lados. WhatsApp lo interpreta; una
 * pantalla web no, y lo que se leía era `**recompra_1_unidad**` con los
 * asteriscos a la vista. Peor todavía cuando el asterisco lo pone el servidor:
 * el cierre de un plan arma su frase con negritas en las cifras.
 *
 * Se interpreta un subconjunto mínimo y se construye con nodos de React, nunca
 * con HTML crudo: el texto viene de un modelo de lenguaje y de lo que escriba
 * una persona, así que insertarlo como HTML sería un XSS con pasos extra.
 *
 * `enlace` existe para el chat de la tienda, que convierte un enlace de
 * carrito en un botón que compra de verdad. Sin ese parámetro, un enlace es un
 * enlace.
 */

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g
/** Negrita, itálica y código. La cursiva exige `_` o `*` pegados a la palabra
 *  para no comerse un asterisco suelto en medio de una frase. */
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g

/** Negritas / itálicas / código dentro de un fragmento sin enlaces. */
export function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, i) => {
    const k = `${keyBase}-${i}`
    if (/^\*\*[^*\n]+\*\*$/.test(part) || /^__[^_\n]+__$/.test(part)) {
      return <strong key={k}>{part.slice(2, -2)}</strong>
    }
    if (/^`[^`\n]+`$/.test(part)) {
      return (
        <code key={k} className="rounded bg-black/5 px-1 py-0.5 text-[0.9em] dark:bg-white/10">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (/^\*[^*\s][^*\n]*\*$/.test(part)) {
      return <em key={k}>{part.slice(1, -1)}</em>
    }
    return <Fragment key={k}>{part}</Fragment>
  })
}

export function TextoRico({
  text,
  enlace,
}: {
  text: string
  /** Cómo dibujar un enlace. Por defecto, un `<a>`. */
  enlace?: (href: string, key: string) => ReactNode
}) {
  // Se trabaja por líneas para poder reconocer viñetas sin un parser entero.
  const lineas = text.split('\n')

  return (
    <>
      {lineas.map((linea, li) => {
        const vineta = /^\s*[-*•]\s+(.*)$/.exec(linea)
        const numerada = /^\s*(\d+)[.)]\s+(.*)$/.exec(linea)
        const contenido = vineta ? vineta[1] : numerada ? numerada[2] : linea

        const nodos = contenido.split(URL_RE).map((part, i) => {
          const k = `${li}-${i}`
          if (i % 2 === 0) return <Fragment key={k}>{inline(part, k)}</Fragment>
          if (enlace) return <Fragment key={k}>{enlace(part, k)}</Fragment>
          return (
            <a
              key={k}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {part}
            </a>
          )
        })

        if (vineta || numerada) {
          return (
            <span key={li} className="flex gap-1.5">
              <span className="shrink-0 opacity-60">{numerada ? `${numerada[1]}.` : '•'}</span>
              <span>{nodos}</span>
            </span>
          )
        }
        // Una línea vacía es un salto de párrafo; se conserva porque el modelo
        // separa ideas con ella y sin eso el mensaje queda en un bloque. Y cada
        // línea es un bloque: como `span` en línea, dos renglones seguidos se
        // pegaban en uno solo — el salto ya se lo comió el `split`.
        return linea.trim() === '' ? (
          <span key={li} className="block h-2" />
        ) : (
          <span key={li} className="block">
            {nodos}
          </span>
        )
      })}
    </>
  )
}
