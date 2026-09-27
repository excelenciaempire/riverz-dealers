export type MercadoLibreSyncFailure = {
  connectionId: string;
  error: string;
};

export function mercadoLibreFailure(
  connectionId: string,
  error: unknown
): MercadoLibreSyncFailure {
  return {
    connectionId,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * La conexión quedó sin forma de renovarse sola: sin refresh_token, o Mercado
 * Libre rechazó el que había. Sólo el comercio la arregla reconectando, y la
 * conexión ya quedó en `error`, que es lo que avisa (Integraciones, el correo
 * al dueño y el vigilante como "Conexión con error"). Contarla además como
 * falla de cada trabajo mandaba cinco avisos más —"Trabajo con errores:
 * mercadolibre-orders", "-claims", "-catalog"…— por la misma cuenta.
 */
export function requiresMercadoLibreReconnect(error: string): boolean {
  return /connection missing refresh_token|token refresh failed \((?:400|401|403)\)/i.test(error);
}

export function hasMercadoLibreFailures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const failures = (value as { failures?: unknown }).failures;
  return Array.isArray(failures) && failures.some(
    (failure) => !requiresMercadoLibreReconnect(String((failure as MercadoLibreSyncFailure)?.error ?? '')),
  );
}

/** Account blocks and exhausted quotas need the next scheduled probe, not a 2-second retry. */
export function onlyPermanentMercadoLibreFailures(results: unknown[]): boolean {
  const errors = results.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const result = value as { failures?: MercadoLibreSyncFailure[]; error?: string };
    if (result.failures?.length) return result.failures.map(failure => failure.error);
    return result.error ? [result.error] : [];
  });
  return errors.length > 0 && errors.every(error =>
    requiresMercadoLibreReconnect(error) || /(?:HTTP\s+(?:401|403|429)\b|^items\/search (?:401|403|429):|user is not active|cuenta está inactiva|account is inactive)/i.test(error)
  );
}
