'use client'

import { OperatorChat } from '@/components/operacion/operator-chat'

/**
 * El chat que opera la cuenta, dentro de la aplicación de siempre.
 *
 * Los márgenes negativos anulan el relleno del contenedor y el alto se calcula
 * contra el viewport descontando el encabezado, que sólo existe en móvil — el
 * mismo truco que usa la bandeja. Es la única forma de que una conversación
 * ocupe la pantalla entera sin sacar la barra lateral del medio: acá el chat es
 * una sección más, no otra aplicación.
 */
export default function ChatPage() {
  return (
    <div className="-m-4 h-[calc(100dvh-3.5rem)] sm:-m-6 lg:-m-8 lg:h-dvh">
      <OperatorChat fullscreen />
    </div>
  )
}
