/**
 * Aplicaciones de Mercado Libre.
 *
 * La pantalla de autorización muestra el nombre y el logo de la aplicación
 * que pide el permiso, no los de Riverz. Por eso toda cuenta nueva se conecta
 * con la aplicación de Riverz (`MERCADOLIBRE_CLIENT_ID`): con la de un
 * comercio, los demás comercios autorizaban a ese comercio.
 *
 * Un `refresh_token` sólo se canjea con la aplicación que lo emitió. La
 * aplicación anterior (`MERCADOLIBRE_LEGACY_CLIENT_ID`) no conecta a nadie:
 * sólo renueva las conexiones que autorizó, hasta que se reconecten.
 */

export interface MercadoLibreApp {
  clientId: string;
  clientSecret: string;
}

/** La aplicación de Riverz: la única con la que se conecta una cuenta. */
export function mercadoLibreApp(): MercadoLibreApp {
  return {
    clientId: process.env.MERCADOLIBRE_CLIENT_ID ?? "",
    clientSecret: process.env.MERCADOLIBRE_CLIENT_SECRET ?? "",
  };
}

/** La aplicación anterior, mientras queden conexiones que dependan de ella. */
export function legacyMercadoLibreApp(): MercadoLibreApp | null {
  const clientId = process.env.MERCADOLIBRE_LEGACY_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIBRE_LEGACY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * La aplicación que autorizó una conexión, anotada en `config.app_id`. Sin
 * esa marca la conexión es anterior al registro, y la autorizó la anterior.
 */
export function mercadoLibreAppFor(appId: unknown): MercadoLibreApp {
  const legacy = legacyMercadoLibreApp();
  const id = appId == null ? "" : String(appId);
  if (legacy && (id === "" || id === legacy.clientId)) return legacy;
  return mercadoLibreApp();
}

/**
 * Si un aviso se repite a `MERCADOLIBRE_NOTIFY_MIRROR_URL`, el sistema del
 * comercio dueño de la aplicación anterior. Sólo le corresponden los avisos
 * de su aplicación: los de la de Riverz son de otros comercios.
 *
 * Se compara como número: el id tiene 16 dígitos y `JSON.parse` redondea los
 * que pasan de 2^53, así que el texto del aviso ya parseado puede no coincidir.
 */
export function mirrorsMercadoLibreNotification(applicationId: unknown): boolean {
  const legacy = legacyMercadoLibreApp();
  return !legacy || (applicationId != null && Number(applicationId) === Number(legacy.clientId));
}
