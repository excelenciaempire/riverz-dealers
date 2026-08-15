import Link from 'next/link';
import { H1, H2, Lead, P, UL, LI, Code } from './_components/prose';
import { CopiarTodo } from './_components/copiar-todo';
import { instruccionesParaAgente } from './_components/instrucciones';

export default function DocsHome() {
  return (
    <article>
      <H1>Documentación de Riverz</H1>
      <Lead>
        Riverz atiende, vende y hace seguimiento por WhatsApp, Instagram, Messenger, correo y
        Mercado Libre. Esta documentación explica cómo conectarle herramientas propias.
      </Lead>

      <H2>Conectar un agente</H2>
      <P>
        Riverz habla <strong>MCP</strong> (Model Context Protocol). Cualquier asistente que lo
        soporte, sea Claude, un flujo de n8n o un desarrollo propio, puede consultar la operación
        de la cuenta y actuar sobre ella: qué conversaciones quedaron sin respuesta, por qué un
        mensaje no llegó, cómo terminó una campaña, o enviarle algo a un cliente.
      </P>
      <P>Hay dos formas de conectarlo y las dos terminan en el mismo lugar.</P>
      <UL>
        <LI>
          <strong>Con una llave</strong> que se copia desde Ajustes y se pega en el cliente. Es la
          vía más corta y funciona con cualquier programa que sepa enviar una cabecera HTTP.{' '}
          <Link href="/documentacion/mcp" className="text-primary underline underline-offset-2">
            Ver cómo
          </Link>
          .
        </LI>
        <LI>
          <strong>Con OAuth</strong>, para los clientes que descubren el servidor por su cuenta y
          abren una pantalla de autorización.{' '}
          <Link
            href="/documentacion/mcp/oauth"
            className="text-primary underline underline-offset-2"
          >
            Ver cómo
          </Link>
          .
        </LI>
      </UL>

      <H2>Para conectar desde un agente</H2>
      <P>
        El botón copia toda la información de conexión en un solo bloque: la dirección, la
        autenticación, las reglas del servidor y el inventario completo de herramientas. Está
        pensado para pegarlo en un asistente y pedirle que se conecte solo.
      </P>
      <div className="mt-4">
        <CopiarTodo texto={instruccionesParaAgente()} />
      </div>

      <H2>Antes de empezar</H2>
      <UL>
        <LI>
          La llave <strong>lleva la cuenta adentro</strong>. Un agente no puede alcanzar la cuenta
          de otro comercio ni aunque lo solicite, porque el servidor no acepta el identificador de
          cuenta que envíe el cliente.
        </LI>
        <LI>
          Las llaves son de <strong>sólo lectura</strong> por defecto. La capacidad de escribir se
          concede aparte.
        </LI>
        <LI>
          Lo irreversible, como enviarle un mensaje a una persona,{' '}
          <strong>no se ejecuta en la primera llamada</strong>. El servidor devuelve qué haría y
          espera una confirmación.
        </LI>
        <LI>
          Toda llamada queda registrada, incluidas las lecturas. El registro se consulta en
          Ajustes, Agentes (MCP).
        </LI>
      </UL>

      <H2>La dirección</H2>
      <P>
        El servidor está en <Code>https://riverz.co/api/mcp</Code>. Es el mismo para las dos formas
        de conexión.
      </P>
    </article>
  );
}
