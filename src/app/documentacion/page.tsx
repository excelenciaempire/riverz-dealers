import Link from 'next/link';
import { H1, H2, Lead, P, UL, LI, Code } from './_components/prose';

export default function DocsHome() {
  return (
    <article>
      <H1>Documentación de Riverz</H1>
      <Lead>
        Riverz atiende, vende y hace seguimiento por WhatsApp, Instagram, Messenger, correo y
        Mercado Libre. Esta documentación es para conectarle tus propias herramientas.
      </Lead>

      <H2>Conectar un agente</H2>
      <P>
        Riverz habla <strong>MCP</strong> (Model Context Protocol). Con eso, cualquier asistente
        que lo soporte —Claude, un flujo de n8n, algo tuyo— puede preguntarle a tu operación y
        actuar sobre ella: quién escribió y nadie contestó, por qué no le llegó el mensaje a un
        cliente, cómo salió una campaña, mandarle algo a alguien.
      </P>
      <P>Hay dos formas de conectarlo, y las dos terminan en el mismo lugar:</P>
      <UL>
        <LI>
          <strong>Con una llave</strong> que copiás de Ajustes y pegás en tu cliente. Es lo más
          rápido y funciona con todo lo que sepa mandar una cabecera.{' '}
          <Link href="/documentacion/mcp" className="text-primary underline underline-offset-2">
            Cómo se hace
          </Link>
          .
        </LI>
        <LI>
          <strong>Con OAuth</strong>, para los clientes que descubren el servidor solos y te
          mandan a una pantalla a decir que sí.{' '}
          <Link
            href="/documentacion/mcp/oauth"
            className="text-primary underline underline-offset-2"
          >
            Cómo funciona
          </Link>
          .
        </LI>
      </UL>

      <H2>Lo que hay que saber antes de empezar</H2>
      <UL>
        <LI>
          La llave <strong>lleva tu cuenta adentro</strong>. No hay forma de que un agente tuyo
          toque la cuenta de otro, ni aunque lo pida: el servidor no le cree cuando nombra una.
        </LI>
        <LI>
          Por defecto las llaves son de <strong>sólo lectura</strong>. Escribir se pide aparte.
        </LI>
        <LI>
          Lo irreversible —mandarle un mensaje a una persona— <strong>no se ejecuta de una</strong>
          : primero devuelve qué haría y espera confirmación.
        </LI>
        <LI>
          Queda registrado todo, incluidas las lecturas. Lo ves en Ajustes → Agentes (MCP).
        </LI>
      </UL>

      <H2>La dirección</H2>
      <P>
        El servidor está en <Code>https://riverz.co/api/mcp</Code>. Es el mismo para las dos
        formas de conectarse.
      </P>
    </article>
  );
}
