import { TN_CLAIM_COOKIE } from "@/lib/commerce/tiendanube-claim-cookies";
import { CLAIM_COOKIE as SHOPIFY_CLAIM_COOKIE } from "@/lib/shopify/claim-cookies";

/**
 * El alta está ABIERTA, con código de invitación.
 *
 * Antes el prelanzamiento cerraba `/registro` entero y la landing ofrecía una
 * lista de espera. Ahora la página se ve y el formulario se puede completar,
 * pero no crea nada sin un código que emitió el equipo desde `/admin/codigos`
 * (ver `lib/auth/signup-codes.ts` y la migración 209). La puerta dejó de ser
 * una variable de entorno y pasó a ser el código.
 *
 * Esto sólo dice si la PÁGINA es alcanzable. Quien la abre sin código llega
 * hasta el botón y ahí se frena: `POST /api/auth/signup` valida el código
 * antes de tocar Supabase.
 *
 * Para volver a cerrarla del todo (abuso, mantenimiento): poner
 * `NEXT_PUBLIC_RIVERZ_SIGNUPS=closed` y redesplegar. La variable es
 * NEXT_PUBLIC_ a propósito — la página de ingreso la lee en el navegador para
 * decidir si muestra el enlace de crear cuenta, y el valor no es un secreto.
 *
 * Las invitaciones de equipo tienen su propio interruptor (`invitesOpen()`) y
 * no pasan por el código: las manda un admin del workspace a un correo puntual.
 */
export function signupsOpen(): boolean {
  return process.env.NEXT_PUBLIC_RIVERZ_SIGNUPS !== "closed";
}

/**
 * Alta permitida porque el comercio llega instalando desde una tienda de
 * aplicaciones.
 *
 * Aunque el alta se cierre a mano, una app publicada en la tienda de Shopify o
 * de Tiendanube no puede quedar cerrada: el comercio instala y lo primero que
 * necesita es crear su cuenta. Sin esta excepción, cada instalación nueva muere
 * en `/ingresar` sin forma de seguir — y es justamente lo que prueba quien
 * revisa la aplicación.
 *
 * La llave es la cookie de reclamo que dejó el callback de la instalación:
 * sólo existe si la plataforma nos devolvió con un token válido.
 *
 * `tiene` se recibe por parámetro para no atar esta función a `next/headers`:
 * la llaman tanto el proxy (que lee `request.cookies`) como la ruta de alta.
 */
export function signupsOpenForInstall(tiene: (nombre: string) => boolean): boolean {
  if (signupsOpen()) return true;
  return llegaInstalando(tiene);
}

/** Hay una instalación de tienda esperando reclamo. */
export function llegaInstalando(tiene: (nombre: string) => boolean): boolean {
  return tiene(TN_CLAIM_COOKIE) || tiene(SHOPIFY_CLAIM_COOKIE);
}

/**
 * ¿Hace falta código de invitación para esta alta?
 *
 * Sí, salvo que el comercio llegue instalando desde una tienda de aplicaciones.
 * Ahí el código no puede existir: quien instala desde Shopify o Tiendanube no
 * habló con nadie del equipo todavía, y quien revisa la aplicación tampoco. La
 * instalación estacionada ES la invitación, y la ruta de alta la verifica
 * contra la base antes de aceptarla.
 */
export function signupNeedsCode(tiene: (nombre: string) => boolean): boolean {
  return !llegaInstalando(tiene);
}

/**
 * Invitaciones de equipo: ABIERTAS aunque el registro público esté cerrado.
 *
 * Sumar a un compañero no es registro público: lo hace un admin del workspace,
 * a un correo puntual, y la cuenta que se crea entra a ESE espacio. Cerrarlo
 * junto con `/registro` dejaba a los clientes sin poder armar su equipo, que es
 * parte del producto que ya pagaron.
 *
 * Para cerrarlas (por ejemplo, si alguien abusa del alta): poner
 * `NEXT_PUBLIC_RIVERZ_INVITES=closed` y redesplegar.
 */
export function invitesOpen(): boolean {
  return process.env.NEXT_PUBLIC_RIVERZ_INVITES !== "closed";
}
