import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description: "Condiciones de uso del servicio riverz.",
  // Public + indexable so Meta can verify the URL during App Review.
  robots: { index: true, follow: true },
};

const UPDATED = "19 de junio de 2026";
const CONTACT = "info@riverzai.com";

export default function TerminosPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        riverz
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        Términos y condiciones
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: {UPDATED}
      </p>

      {/* TODO (legal): este texto es una base razonable para un SaaS B2B y
          debe ser revisado y validado por un abogado antes de considerarse
          definitivo. Ajusta jurisdicción, responsabilidad, planes y precios
          según la operación real de riverz. */}
      <p className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Documento base pendiente de revisión legal. Las condiciones definitivas
        pueden variar.
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <Section title="1. Aceptación de los términos">
          <p>
            Estos términos y condiciones (los &laquo;Términos&raquo;) regulan el
            acceso y uso de la plataforma riverz (el &laquo;Servicio&raquo;),
            disponible en{" "}
            <a href="https://riverz.co" className="underline">
              riverz.co
            </a>
            . Al crear una cuenta o usar el Servicio, aceptas estos Términos y
            nuestra{" "}
            <Link href="/privacidad" className="underline">
              Política de privacidad
            </Link>
            . Si no estás de acuerdo, no debes usar el Servicio.
          </p>
        </Section>

        <Section title="2. Descripción del servicio">
          <p>
            riverz es una plataforma de atención y CRM omnicanal que permite a
            comercios y empresas centralizar, automatizar y responder, desde una
            sola bandeja, las conversaciones de sus clientes en WhatsApp,
            Instagram, Messenger y correo electrónico, así como gestionar
            campañas, productos y respuestas asistidas por IA. Podemos
            modificar, ampliar o suspender funciones del Servicio en cualquier
            momento.
          </p>
        </Section>

        <Section title="3. Cuentas y elegibilidad">
          <p>
            Para usar el Servicio debes crear una cuenta con información veraz y
            mantenerla actualizada. Eres responsable de la confidencialidad de
            tus credenciales y de toda la actividad que ocurra bajo tu cuenta.
            Debes ser mayor de edad y tener capacidad legal para contratar, y
            usar el Servicio en nombre de una empresa o actividad comercial
            legítima.
          </p>
        </Section>

        <Section title="4. Uso aceptable">
          <p>Al usar el Servicio te comprometes a no:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Enviar spam, mensajes no solicitados o contenido que infrinja las
              políticas de WhatsApp, Meta u otros canales conectados.
            </li>
            <li>
              Usar el Servicio para fines ilegales, fraudulentos o que vulneren
              derechos de terceros.
            </li>
            <li>
              Intentar acceder sin autorización a sistemas, datos o cuentas que
              no te pertenezcan.
            </li>
            <li>
              Sobrecargar, interferir o comprometer la seguridad o el
              funcionamiento del Servicio.
            </li>
          </ul>
          <p className="mt-2">
            Eres el único responsable del contenido que envías y de obtener el
            consentimiento necesario de los destinatarios de tus mensajes.
          </p>
        </Section>

        <Section title="5. Canales y servicios de terceros">
          <p>
            El Servicio se integra con plataformas de terceros (Meta/WhatsApp,
            Instagram, Messenger, Shopify, proveedores de correo y modelos de
            IA). El uso de esas integraciones está sujeto a los términos y
            políticas de cada proveedor. No somos responsables de cambios,
            interrupciones o decisiones de esas plataformas que afecten el
            Servicio.
          </p>
        </Section>

        <Section title="6. Planes, pagos y facturación">
          <p>
            Algunas funciones del Servicio pueden requerir un plan de pago. Los
            precios, ciclos de facturación y condiciones aplicables se informan
            al momento de la contratación. Salvo que la ley exija lo contrario,
            los pagos no son reembolsables. Podemos actualizar los precios
            notificándolo con antelación razonable.
          </p>
        </Section>

        <Section title="7. Propiedad intelectual">
          <p>
            El Servicio, su software, marca y contenido son propiedad de riverz
            o de sus licenciantes. Te otorgamos una licencia limitada, no
            exclusiva e intransferible para usar el Servicio conforme a estos
            Términos. Tú conservas la titularidad de los datos y contenidos que
            cargas o gestionas a través del Servicio.
          </p>
        </Section>

        <Section title="8. Datos y privacidad">
          <p>
            El tratamiento de los datos personales se rige por nuestra{" "}
            <Link href="/privacidad" className="underline">
              Política de privacidad
            </Link>
            . Cuando conectas tus cuentas, procesamos datos en tu nombre y bajo
            tus instrucciones únicamente para prestar el Servicio.
          </p>
        </Section>

        <Section title="9. Disponibilidad y garantías">
          <p>
            Trabajamos para mantener el Servicio disponible y seguro, pero se
            ofrece &laquo;tal cual&raquo; y &laquo;según disponibilidad&raquo;,
            sin garantías de funcionamiento ininterrumpido o libre de errores.
            En la medida permitida por la ley, no garantizamos resultados
            comerciales específicos derivados del uso del Servicio.
          </p>
        </Section>

        <Section title="10. Limitación de responsabilidad">
          <p>
            En la medida máxima permitida por la ley, riverz no será responsable
            por daños indirectos, incidentales o lucro cesante derivados del uso
            o de la imposibilidad de usar el Servicio. Nuestra responsabilidad
            total se limitará al monto pagado por el Servicio en los doce (12)
            meses anteriores al hecho que origine el reclamo.
          </p>
        </Section>

        <Section title="11. Suspensión y terminación">
          <p>
            Puedes dejar de usar el Servicio y cerrar tu cuenta en cualquier
            momento. Podemos suspender o cancelar tu acceso si incumples estos
            Términos o si tu uso compromete la seguridad o el cumplimiento legal
            del Servicio. Tras la terminación, eliminaremos o anonimizaremos tus
            datos conforme a la Política de privacidad.
          </p>
        </Section>

        <Section title="12. Cambios en los términos">
          <p>
            Podemos actualizar estos Términos. Publicaremos la versión vigente en
            esta página con su fecha de actualización. El uso continuado del
            Servicio tras los cambios implica su aceptación.
          </p>
        </Section>

        <Section title="13. Ley aplicable">
          <p>
            Estos Términos se rigen por la legislación aplicable en la
            jurisdicción donde opera riverz. Cualquier controversia se someterá a
            los tribunales competentes de dicha jurisdicción, sin perjuicio de
            los derechos que la ley reconozca como irrenunciables.
          </p>
        </Section>

        <Section title="14. Contacto">
          <p>
            ¿Preguntas sobre estos Términos? Escríbenos a{" "}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            .
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/privacidad" className="underline">
          Política de privacidad
        </Link>
        <span className="mx-2">·</span>
        <Link href="/eliminar-datos" className="underline">
          Eliminar mis datos
        </Link>
        <span className="mx-2">·</span>
        <a href="https://riverz.co" className="underline">
          riverz.co
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
