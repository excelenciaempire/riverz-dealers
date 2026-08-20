import { ChatApp } from '@/components/webchat/chat-app';

/**
 * La página del chat. No recibe nada del servidor: el token de sesión llega en
 * el fragmento de la URL (`#s=…`), que el navegador nunca manda, así que sólo
 * el cliente puede leerlo. De ahí que todo el trabajo esté en `ChatApp`.
 */
export default function WidgetChatPage() {
  return <ChatApp />;
}
