/**
 * Pre-launch gate: account creation is CLOSED.
 *
 * Riverz is in pre-launch — the landing offers a waitlist instead of a
 * sign-up form (see `src/app/api/waitlist/route.ts`). This flag closes the
 * three code paths that can mint a Supabase `auth.users` row:
 *
 *   1. `POST /api/auth/signup`            → 403
 *   2. `/registro` + `/signup` page       → redirected to the landing in `proxy.ts`
 *
 * Las invitaciones de equipo NO entran acá: tienen su propio interruptor
 * (`invitesOpen()`, más abajo) y siguen abiertas durante el prelanzamiento.
 *
 * Existing users keep signing in, recovering passwords and confirming email
 * as usual — nothing here touches `/ingresar`, `/recuperar-clave`,
 * `/nueva-clave` or `/auth/callback`.
 *
 * To reopen: set `NEXT_PUBLIC_RIVERZ_SIGNUPS=open` and redeploy. The var is
 * NEXT_PUBLIC_ on purpose — the login page reads it in the browser to decide
 * whether to show the "create account" link, and the value is not a secret.
 *
 * NOTE: this closes Riverz's own routes. Supabase's `/auth/v1/signup`
 * endpoint is reachable directly with the public anon key, so the full
 * lock also needs "Allow new users to sign up" turned OFF in the Supabase
 * dashboard (Authentication → Sign In / Providers → Email).
 */
export function signupsOpen(): boolean {
  return process.env.NEXT_PUBLIC_RIVERZ_SIGNUPS === "open";
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
