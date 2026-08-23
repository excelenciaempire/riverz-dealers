'use client'

import { OperatorChat } from '@/components/operacion/operator-chat'
import { Banco, BancoEnHoja, bancoTieneAlgo } from '@/components/operacion/banco'
import { MesaProvider, useMesa } from '@/components/operacion/mesa-contexto'
import { cn } from '@/lib/utils'

/**
 * El taller: el pedido al margen, la pieza sobre la mesa.
 *
 * Los márgenes negativos anulan el relleno del contenedor y el alto se calcula
 * contra el viewport descontando el encabezado, que sólo existe en móvil — el
 * mismo truco que usa la bandeja. Es la única forma de que el taller ocupe la
 * pantalla entera sin sacar la barra lateral del medio.
 *
 * **El banco no está abierto por costumbre**: aparece cuando hay una pieza que
 * mirar y se corre cuando no. Mientras tanto la conversación se queda con la
 * pantalla, centrada y con ancho de lectura, en vez de vivir apretada contra un
 * lienzo vacío.
 */
export default function ChatPage() {
  return (
    <MesaProvider>
      <Taller />
    </MesaProvider>
  )
}

function Taller() {
  const m = useMesa()
  const hayPieza = bancoTieneAlgo(m)

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] sm:-m-6 lg:-m-8 lg:h-dvh">
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[flex-basis] duration-200',
          hayPieza
            ? 'lg:flex-none lg:basis-[24rem] lg:border-r lg:border-border xl:basis-[27rem]'
            : 'mx-auto max-w-2xl',
        )}
      >
        <OperatorChat fullscreen />
      </div>
      {/* Debajo de `lg` no hay ancho para las dos sin ahogar las dos: ahí la
          pieza sube como hoja desde abajo. */}
      {hayPieza && <Banco className="hidden flex-1 lg:flex" />}
      <BancoEnHoja />
    </div>
  )
}
