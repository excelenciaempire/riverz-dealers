import type { Metadata } from 'next';

/**
 * El chat vive en un iframe dentro de la tienda del comercio, no en el panel.
 *
 * No define `<html>`/`<body>` —eso es del layout raíz— pero sí corta con todo
 * lo demás: nada de barra lateral, nada de tokens de tema del panel. Los
 * colores se escriben explícitos en los componentes porque acá el tema no lo
 * elige quien administra la cuenta sino el comercio, con su color de marca.
 */
export const metadata: Metadata = {
  title: 'Chat',
  // Un iframe de chat no tiene por qué aparecer en ningún buscador.
  robots: { index: false, follow: false },
};

export default function WidgetChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh w-full overflow-hidden bg-white">{children}</div>;
}
