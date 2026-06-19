import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Cómo riverz recopila, usa y protege tus datos.",
  // Public + indexable so Meta can verify the URL during App Review.
  robots: { index: true, follow: true },
};

const UPDATED = "19 de junio de 2026";
const CONTACT = "info@riverzai.com";

export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        riverz
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        Política de privacidad
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: {UPDATED}
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <Section title="1. Quiénes somos">
          <p>
            riverz es una plataforma de atención y CRM omnicanal que permite a
            comercios y empresas centralizar y responder, desde una sola bandeja,
            las conversaciones de sus clientes en WhatsApp, Instagram, Messenger y
            correo electrónico. El servicio se presta a través de{" "}
            <a href="https://app.riverz.app" className="underline">
              app.riverz.app
            </a>
            . Para cualquier consulta sobre privacidad escríbenos a{" "}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <Section title="2. Qué datos tratamos">
          <p>Tratamos dos tipos de información:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Datos del comercio (nuestro cliente):</strong> nombre,
              correo, datos de la cuenta y de la empresa, y los tokens de acceso
              de las cuentas que conecta (WhatsApp, Páginas de Facebook, cuentas
              de Instagram, Shopify, correo). Los tokens se guardan cifrados.
            </li>
            <li>
              <strong>Datos de los clientes finales del comercio:</strong> cuando
              un comercio conecta sus cuentas, procesamos en su nombre los
              mensajes, comentarios, nombre de perfil público, identificadores de
              usuario y metadatos de las conversaciones que esas personas le
              envían, para mostrarlos en la bandeja y permitir responderlos.
            </li>
          </ul>
        </Section>

        <Section title="3. Para qué usamos los datos">
          <p>
            Usamos los datos únicamente para prestar el servicio: recibir y
            mostrar mensajes y comentarios, permitir que el comercio responda,
            ofrecer respuestas asistidas por IA cuando el comercio lo activa,
            generar estadísticas de atención y mantener la seguridad del sistema.
            No vendemos datos personales ni los usamos para publicidad de
            terceros.
          </p>
        </Section>

        <Section title="4. Plataformas de Meta">
          <p>
            riverz utiliza las APIs de Meta (WhatsApp Business, Messenger
            Platform e Instagram). Cuando un comercio conecta su Página de
            Facebook o su cuenta de Instagram, accedemos a sus mensajes y
            comentarios <strong>solo</strong> en las cuentas que él mismo
            autoriza, y exclusivamente para que pueda gestionarlos desde riverz.
            El uso de la información obtenida de Meta cumple con las Políticas de
            la Plataforma de Meta. No accedemos a cuentas de terceros que el
            comercio no haya conectado.
          </p>
        </Section>

        <Section title="5. Con quién compartimos datos (subencargados)">
          <p>
            Nos apoyamos en proveedores que tratan datos por cuenta nuestra, bajo
            contrato y solo para operar el servicio:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Meta Platforms (APIs de WhatsApp, Messenger e Instagram).</li>
            <li>Supabase (base de datos y almacenamiento).</li>
            <li>Render (alojamiento de la aplicación).</li>
            <li>Anthropic (modelos de IA, solo cuando el comercio activa el asistente).</li>
            <li>Shopify (cuando el comercio conecta su tienda).</li>
          </ul>
        </Section>

        <Section title="6. Conservación">
          <p>
            Conservamos los datos mientras la cuenta del comercio esté activa y
            sean necesarios para prestar el servicio. Cuando una cuenta se
            elimina, o cuando se recibe una solicitud de eliminación válida,
            borramos o anonimizamos los datos asociados en un plazo razonable.
          </p>
        </Section>

        <Section title="7. Tus derechos y eliminación de datos">
          <p>
            Puedes solicitar acceso, corrección o eliminación de tus datos. Si
            eres un usuario que interactuó con un comercio que usa riverz, puedes
            pedir la eliminación de tus datos en cualquier momento.
          </p>
          <p className="mt-2">
            Consulta cómo en{" "}
            <Link href="/eliminar-datos" className="underline">
              app.riverz.app/eliminar-datos
            </Link>
            . Las solicitudes automáticas de Meta (al eliminar la app) se
            procesan a través de nuestro callback de eliminación de datos.
          </p>
        </Section>

        <Section title="8. Seguridad">
          <p>
            Ciframos los tokens de acceso, verificamos la firma de los webhooks
            entrantes y aplicamos control de acceso por cuenta. Aun así, ningún
            sistema es 100% infalible; trabajamos para proteger tu información de
            forma continua.
          </p>
        </Section>

        <Section title="9. Cambios">
          <p>
            Podemos actualizar esta política. Publicaremos los cambios en esta
            página con su fecha de actualización.
          </p>
        </Section>

        <Section title="10. Contacto">
          <p>
            ¿Preguntas? Escríbenos a{" "}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            .
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/eliminar-datos" className="underline">
          Eliminar mis datos
        </Link>
        <span className="mx-2">·</span>
        <a href="https://app.riverz.app" className="underline">
          app.riverz.app
        </a>
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-2 text-foreground/85">{children}</div>
    </section>
  );
}
