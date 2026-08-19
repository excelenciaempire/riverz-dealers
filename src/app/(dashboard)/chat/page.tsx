import { OperatorChat } from '@/components/operacion/operator-chat'

/**
 * La casa de Riverz 2.0.
 *
 * Sin encabezado ni título: la conversación ocupa la pantalla entera. El chrome
 * (pestañas, cuenta, tema) lo pone el shell.
 */
export default function ChatPage() {
  return <OperatorChat fullscreen />
}
