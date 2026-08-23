'use client'

import { OperatorChat } from '@/components/operacion/operator-chat'
import { Banco, BancoEnHoja } from '@/components/operacion/banco'
import { MesaProvider } from '@/components/operacion/mesa-contexto'

/**
 * El taller: el pedido al margen, la pieza sobre la mesa.
 *
 * Los márgenes negativos anulan el relleno del contenedor y el alto se calcula
 * contra el viewport descontando el encabezado, que sólo existe en móvil — el
 * mismo truco que usa la bandeja. Es la única forma de que el taller ocupe la
 * pantalla entera sin sacar la barra lateral del medio.
 *
 * **La conversación deja de ser el protagonista.** Antes era una columna ancha
 * centrada con un panel al costado, y lo que se estaba construyendo —una
 * automatización de nueve pasos, que en su propia pantalla ocupa un lienzo con
 * zoom— aparecía del tamaño de un sello. Ahora el pedido vive en una columna
 * angosta de lectura y el banco se queda con el resto.
 *
 * Las dos zonas son HERMANAS y no una dentro de otra: cada una tiene su propio
 * scroll, y meter el banco adentro del hilo obligaría a reestructurarlo entero.
 */
export default function ChatPage() {
  return (
    <MesaProvider>
      <div className="-m-4 flex h-[calc(100dvh-3.5rem)] sm:-m-6 lg:-m-8 lg:h-dvh">
        <div className="flex min-w-0 flex-1 flex-col lg:flex-none lg:basis-[24rem] lg:border-r lg:border-border xl:basis-[27rem]">
          <OperatorChat fullscreen />
        </div>
        {/* Debajo de `lg` no hay ancho para las dos sin ahogar las dos: ahí la
            pieza sube como hoja desde abajo. */}
        <Banco className="hidden flex-1 lg:flex" />
        <BancoEnHoja />
      </div>
    </MesaProvider>
  )
}
