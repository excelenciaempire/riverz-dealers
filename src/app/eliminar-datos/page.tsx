import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eliminar mis datos",
  description: "Cómo solicitar la eliminación de tus datos en riverz.",
  // Public + indexable so Meta can verify the URL during App Review.
  robots: { index: true, follow: true },
};

const CONTACT = "info@riverzai.com";

export default async function EliminarDatosPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        riverz
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        Eliminar mis datos
      </h1>

      {code && (
        <div className="mt-6 rounded-lg border border-emerald-600/30 bg-emerald-500/5 px-4 py-3 text-sm text-foreground">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            Solicitud recibida
          </p>
          <p className="mt-1 text-foreground/85">
            Tu solicitud de eliminación se está procesando. Código de
            confirmación:{" "}
            <span className="font-mono text-foreground">{code}</span>
          </p>
          <p className="mt-1 text-foreground/85">
            Los datos asociados se eliminan o anonimizan en un plazo razonable.
            Guarda este código por si necesitas referirte a la solicitud.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <p>
          En riverz puedes pedir que eliminemos tus datos personales en
          cualquier momento. Tienes dos formas de hacerlo:
        </p>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            1. Desde Facebook o Instagram
          </h2>
          <p className="mt-2 text-foreground/85">
            Si conectaste tu cuenta o interactuaste con un comercio que usa
            riverz a través de Facebook o Instagram, puedes quitar la app desde la
            configuración de tu cuenta de Meta (Configuración → Apps y sitios web).
            Meta nos notifica automáticamente y procesamos la eliminación de tus
            datos.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            2. Por correo
          </h2>
          <p className="mt-2 text-foreground/85">
            Escríbenos a{" "}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>{" "}
            desde el correo asociado a tu cuenta, o indicando tu identificador o
            número, y eliminaremos o anonimizaremos tus datos. Te confirmaremos
            cuando esté hecho.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Qué eliminamos
          </h2>
          <p className="mt-2 text-foreground/85">
            Mensajes, comentarios, nombre de perfil, identificadores y metadatos
            de conversación asociados a tu cuenta en nuestra base de datos. Cierta
            información puede conservarse si la ley lo exige.
          </p>
        </section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/privacidad" className="underline">
          Política de privacidad
        </Link>
        <span className="mx-2">·</span>
        <a href="https://riverz.co" className="underline">
          riverz.co
        </a>
      </footer>
    </main>
  );
}
