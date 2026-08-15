import { Pause } from "lucide-react";
import { getT } from "@/lib/i18n/server";

const CONTACTO = "riverzoficial@gmail.com";

/**
 * Pantalla completa para una cuenta suspendida.
 *
 * Riverz se cobra por fuera de la aplicación; cuando el equipo da de baja
 * una cuenta, esto es lo que ve el comercio en vez del panel.
 *
 * Dice "en pausa" y no "no pagaste" a propósito: la suspensión también se
 * usa para bajas voluntarias y para cuentas de prueba que se cierran, y en
 * ninguno de esos casos corresponde acusar a nadie. El motivo que anota el
 * equipo es una nota interna y NO se muestra acá.
 *
 * Tampoco cierra la sesión: la persona sigue autenticada, así que en cuanto
 * se reactiva la cuenta vuelve a entrar sin hacer nada.
 */
export async function SuspendedGate() {
  const t = await getT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-5">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <Pause className="size-5 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">
          {t("nav.suspendedTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("nav.suspendedBody")}
        </p>
        <a
          href={`mailto:${CONTACTO}`}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("nav.suspendedCta")}
        </a>
      </div>
    </div>
  );
}
