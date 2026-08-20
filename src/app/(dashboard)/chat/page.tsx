'use client'

import { OperatorChat } from '@/components/operacion/operator-chat'
import { Mesa } from '@/components/operacion/mesa'
import { MesaProvider } from '@/components/operacion/mesa-contexto'

/**
 * El chat que opera la cuenta, dentro de la aplicación de siempre.
 *
 * Los márgenes negativos anulan el relleno del contenedor y el alto se calcula
 * contra el viewport descontando el encabezado, que sólo existe en móvil — el
 * mismo truco que usa la bandeja. Es la única forma de que una conversación
 * ocupe la pantalla entera sin sacar la barra lateral del medio: acá el chat es
 * una sección más, no otra aplicación.
 *
 * La mesa de trabajo entra como HERMANA del chat y no adentro. La raíz del chat
 * tiene su propio scroll y su compositor; meter el panel ahí obligaría a
 * reestructurarla entera, y el scroll del hilo dejaría de ser el único de la
 * columna. Como hermanos, cada uno tiene el suyo y no se pisan.
 */
export default function ChatPage() {
  return (
    <MesaProvider>
      <div className="-m-4 flex h-[calc(100dvh-3.5rem)] sm:-m-6 lg:-m-8 lg:h-dvh">
        <div className="min-w-0 flex-1">
          <OperatorChat fullscreen />
        </div>
        <Mesa />
      </div>
    </MesaProvider>
  )
}
