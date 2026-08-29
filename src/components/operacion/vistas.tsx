'use client'

import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import type { Artefacto } from '@/lib/operator/artifacts'
import { cn } from '@/lib/utils'
import { Fichas, Marco, Nada } from './marco'

/**
 * Lo que Riverz LEE, dibujado.
 *
 * El panel de la derecha sabía dibujar lo que el equipo construye —el árbol de
 * una automatización, la plantilla en su teléfono— y nada más. Pero la mitad de
 * lo que se le pide al Operador es mirar: cómo vienen las ventas, qué pedidos
 * hay, qué dijo este cliente, por qué no salió aquel mensaje. Todo eso
 * contestaba un párrafo y dejaba el lienzo vacío.
 *
 * Son siete formas genéricas y no una por capacidad, a propósito: ciento diez
 * capacidades son ciento diez dibujos que nadie mantiene. El servidor elige la
 * forma y llena los huecos; acá sólo se dibuja.
 *
 * Y son dibujos PROPIOS, no los componentes de la pantalla de siempre. Aquéllos
 * están atados a filas enteras de la base y arrastran sus contextos; acá lo que
 * llega es un resumen que ya viene formateado y traducido desde el servidor.
 */
type Vista = Extract<
  Artefacto,
  { kind: 'tabla' | 'cifras' | 'ficha' | 'conversacion' | 'tablero' | 'pedido' | 'cambio' }
>

export function VistaDeDatos({ vista }: { vista: Vista }) {
  switch (vista.kind) {
    case 'tabla':
      return <Tabla v={vista} />
    case 'cifras':
      return <Cifras v={vista} />
    case 'ficha':
      return <Ficha v={vista} />
    case 'conversacion':
      return <Conversacion v={vista} />
    case 'tablero':
      return <Tablero v={vista} />
    case 'pedido':
      return <Pedido v={vista} />
    case 'cambio':
      return <CambioVista v={vista} />
  }
}

/** Las formas que se llevan una franja entera; el resto va en columna angosta. */
export const VISTAS_ANCHAS: ReadonlySet<string> = new Set([
  'tabla',
  'cifras',
  'conversacion',
  'tablero',
])

// --- Tabla -----------------------------------------------------------------

function Tabla({ v }: { v: Extract<Vista, { kind: 'tabla' }> }) {
  const t = useT()
  const bajada =
    v.total !== undefined && v.total > v.filas.length
      ? `${v.filas.length} ${t('operation.vistaDe')} ${v.total}`
      : undefined

  if (v.filas.length === 0) {
    return (
      <Marco titulo={v.titulo}>
        <Nada>{v.vacio ?? t('operation.vistaSinFilas')}</Nada>
      </Marco>
    )
  }

  return (
    <Marco titulo={v.titulo} bajada={bajada}>
      {/* El scroll horizontal vive acá adentro: una tabla ancha no puede
          empujar el panel entero, que es lo que pasa si el overflow queda en el
          contenedor de afuera. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              {v.columnas.map((c) => (
                <th
                  key={c.clave}
                  className={cn(
                    'app-eyebrow py-1.5 pr-4 font-medium whitespace-nowrap text-muted-foreground',
                    c.alineado === 'der' && 'pr-0 pl-4 text-right',
                  )}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.filas.map((f, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                {v.columnas.map((c) => (
                  <td
                    key={c.clave}
                    className={cn(
                      'py-1.5 pr-4 align-top text-foreground',
                      c.alineado === 'der' && 'pr-0 pl-4 text-right tabular-nums',
                    )}
                  >
                    {f[c.clave] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Marco>
  )
}

// --- Cifras ----------------------------------------------------------------

const TONO_DELTA: Record<string, string> = {
  bueno: 'text-accent-ink',
  malo: 'text-destructive',
  neutro: 'text-muted-foreground',
}

function Cifras({ v }: { v: Extract<Vista, { kind: 'cifras' }> }) {
  const t = useT()
  if (v.tiles.length === 0) {
    return (
      <Marco titulo={v.titulo} bajada={v.bajada}>
        <Nada>{t('operation.vistaSinDatos')}</Nada>
      </Marco>
    )
  }
  return (
    <Marco titulo={v.titulo} bajada={v.bajada}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {v.tiles.map((c) => {
          const Icono = c.tono === 'bueno' ? TrendingUp : c.tono === 'malo' ? TrendingDown : Minus
          return (
            <div key={c.etiqueta} className="rounded-lg border border-border/70 bg-background p-2.5">
              <p className="app-eyebrow truncate text-muted-foreground">{c.etiqueta}</p>
              <p className="mt-0.5 text-lg leading-tight font-medium tabular-nums text-foreground">
                {c.valor}
              </p>
              {c.delta && (
                <p
                  className={cn(
                    'mt-0.5 flex items-center gap-1 text-[11px] tabular-nums',
                    TONO_DELTA[c.tono ?? 'neutro'],
                  )}
                >
                  <Icono className="size-3 shrink-0" />
                  {c.delta}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {v.serie && v.serie.length > 0 && <Barras serie={v.serie} />}
    </Marco>
  )
}

/**
 * La serie, en barras.
 *
 * Sin librería y sin ejes: lo que hace falta acá es la FORMA —si sube, si cae,
 * si hay un pico—, y para eso alcanza con la altura relativa. El número exacto
 * ya está en los recuadros de arriba.
 */
function Barras({ serie }: { serie: { etiqueta: string; valor: number }[] }) {
  const tope = Math.max(...serie.map((p) => p.valor), 0)
  return (
    <div className="mt-3 flex h-[72px] items-end gap-1">
      {serie.map((p, i) => (
        <div key={`${p.etiqueta}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-sm bg-primary/40"
              // Un valor de cero tiene que verse como cero y no como una barra
              // mínima: una línea de base falsa se lee como "hubo algo".
              style={{ height: tope > 0 ? `${(p.valor / tope) * 100}%` : 0 }}
              title={`${p.etiqueta}: ${p.valor}`}
            />
          </div>
          <span className="w-full truncate text-center text-[10px] text-muted-foreground">
            {p.etiqueta}
          </span>
        </div>
      ))}
    </div>
  )
}

// --- Ficha -----------------------------------------------------------------

function Ficha({ v }: { v: Extract<Vista, { kind: 'ficha' }> }) {
  return (
    <Marco titulo={v.titulo} bajada={v.subtitulo}>
      {v.chips && v.chips.length > 0 && <Fichas items={v.chips} />}
      <dl className="mt-2 flex flex-col gap-1.5">
        {v.campos.map((c, i) => (
          <div key={`${c.etiqueta}-${i}`} className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-[11px] text-muted-foreground">{c.etiqueta}</dt>
            <dd className="min-w-0 flex-1 text-right text-xs break-words text-foreground">
              {c.valor}
            </dd>
          </div>
        ))}
      </dl>
      {v.nota && <p className="mt-2 text-[11px] text-muted-foreground">{v.nota}</p>}
    </Marco>
  )
}

// --- Conversacion ----------------------------------------------------------

function Conversacion({ v }: { v: Extract<Vista, { kind: 'conversacion' }> }) {
  const t = useT()
  if (v.mensajes.length === 0) {
    return (
      <Marco titulo={v.titulo} bajada={v.canal}>
        <Nada>{t('operation.vistaSinMensajes')}</Nada>
      </Marco>
    )
  }
  return (
    <Marco titulo={v.titulo} bajada={v.canal}>
      <ol className="flex flex-col gap-2">
        {v.mensajes.map((m, i) => (
          <li
            key={i}
            className={cn(
              'flex flex-col',
              m.de === 'negocio' ? 'items-end' : m.de === 'nota' ? 'items-center' : 'items-start',
            )}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-1.5 text-xs leading-snug whitespace-pre-line',
                m.de === 'cliente' &&
                  'rounded-bl-sm border border-border bg-background text-foreground',
                m.de === 'negocio' && 'rounded-br-sm bg-primary/15 text-foreground',
                // Una nota interna no es un mensaje: no la leyó nadie de afuera
                // y no puede parecer parte de la conversación.
                m.de === 'nota' &&
                  'border border-dashed border-border text-[11px] text-muted-foreground italic',
              )}
            >
              {m.texto}
            </div>
            {m.cuando && (
              <span className="mt-0.5 text-[10px] text-muted-foreground">{m.cuando}</span>
            )}
          </li>
        ))}
      </ol>
    </Marco>
  )
}

// --- Tablero ---------------------------------------------------------------

const PUNTO: Record<string, string> = {
  ok: 'bg-accent-ink',
  atencion: 'bg-amber-500',
  roto: 'bg-destructive',
  apagado: 'bg-border',
}

function Tablero({ v }: { v: Extract<Vista, { kind: 'tablero' }> }) {
  const t = useT()
  if (v.filas.length === 0) {
    return (
      <Marco titulo={v.titulo}>
        <Nada>{t('operation.vistaSinDatos')}</Nada>
      </Marco>
    )
  }
  return (
    <Marco titulo={v.titulo}>
      <ul className="flex flex-col gap-1">
        {v.filas.map((f, i) => (
          <li
            key={`${f.que}-${i}`}
            className="flex items-start gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5"
          >
            <span
              className={cn('mt-1.5 size-2 shrink-0 rounded-full', PUNTO[f.estado])}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs leading-snug text-foreground">{f.que}</span>
              {f.detalle && (
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {f.detalle}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Marco>
  )
}

// --- Pedido ----------------------------------------------------------------

function Pedido({ v }: { v: Extract<Vista, { kind: 'pedido' }> }) {
  const t = useT()
  return (
    <Marco titulo={v.nombre ?? t('operation.vistaPedido')} bajada={v.cliente} base={v.base}>
      <ul className="flex flex-col gap-1">
        {v.items.map((it, i) => (
          <li
            key={`${it.que}-${i}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 text-xs leading-snug text-foreground">
              {it.cantidad > 1 && (
                <span className="tabular-nums text-muted-foreground">{it.cantidad}× </span>
              )}
              {it.que}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-foreground">{it.precio}</span>
          </li>
        ))}
      </ul>
      {v.envio && (
        <p className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>{t('operation.vistaEnvio')}</span>
          <span className="tabular-nums">{v.envio}</span>
        </p>
      )}
      <p className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-medium text-foreground">
        <span>{t('operation.vistaTotal')}</span>
        <span className="tabular-nums">{v.total}</span>
      </p>
      {v.estado && <Fichas items={[v.estado]} />}
      {/* El enlace de pago se MUESTRA, no se abre: es lo que se le va a mandar a
          alguien, y abrirlo desde acá crearía una sesión de checkout que no es
          de nadie. */}
      {v.enlace && (
        <p className="mt-2 truncate rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-accent-ink">
          {v.enlace}
        </p>
      )}
    </Marco>
  )
}

// --- Cambio ----------------------------------------------------------------

function CambioVista({ v }: { v: Extract<Vista, { kind: 'cambio' }> }) {
  return (
    <Marco titulo={v.titulo} bajada={v.que} base={v.base}>
      {v.alcance && <p className="text-xs text-accent-ink">{v.alcance}</p>}
      {v.campos && v.campos.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {v.campos.map((c, i) => (
            <li
              key={`${c.etiqueta}-${i}`}
              className="rounded-lg border border-accent-ink/30 bg-primary/10 px-2.5 py-1.5"
            >
              <p className="app-eyebrow text-muted-foreground">{c.etiqueta}</p>
              {/* Lo que decía antes, tachado y arriba: es la única forma de
                  aprobar un cambio mirando en vez de recordando. */}
              {c.antes !== undefined && c.antes !== '' && (
                <p className="text-[11px] leading-snug text-muted-foreground line-through">
                  {c.antes}
                </p>
              )}
              <p className="text-xs leading-snug text-foreground">{c.despues}</p>
            </li>
          ))}
        </ul>
      )}
      {v.aviso && (
        <p className="mt-2 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {v.aviso}
        </p>
      )}
    </Marco>
  )
}
