import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * "Probar" antes de pagar el link.
 *
 * Una cuenta que todavía no pagó (`cortesia`) no usa la IA en vivo, pero tiene
 * que poder probar su asistente: es justo antes de pagar cuando más lo
 * necesita. Adentro de este alcance la puerta la deja pasar, y la prueba corre
 * entera —el triaje, la verificación de la respuesta, el filtro de spam— igual
 * que en producción, en vez de saltearse en silencio lo que se cobra.
 *
 * Afuera no cambia nada: ningún webhook ni cron corre acá adentro, así que la
 * cuenta sigue sin contestar en vivo hasta que paga. La prueba la cubre
 * Riverz, como la instalación. Sin saldo o con la suscripción vencida se sigue
 * frenando.
 */
const alcance = new AsyncLocalStorage<true>();

export function probandoSinPagar<T>(fn: () => Promise<T>): Promise<T> {
  return alcance.run(true, fn);
}

export function enPruebaSinPagar(): boolean {
  return alcance.getStore() === true;
}
