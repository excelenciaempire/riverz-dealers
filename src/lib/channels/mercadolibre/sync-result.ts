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

export function hasMercadoLibreFailures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const failures = (value as { failures?: unknown }).failures;
  return Array.isArray(failures) && failures.length > 0;
}

/** Account/permission blocks need the next scheduled probe, not a 2-second retry. */
export function onlyPermanentMercadoLibreFailures(results: unknown[]): boolean {
  const errors = results.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const result = value as { failures?: MercadoLibreSyncFailure[]; error?: string };
    if (result.failures?.length) return result.failures.map(failure => failure.error);
    return result.error ? [result.error] : [];
  });
  return errors.length > 0 && errors.every(error =>
    /(?:HTTP\s+(?:401|403)\b|^items\/search (?:401|403):|user is not active|cuenta está inactiva|account is inactive)/i.test(error)
  );
}
