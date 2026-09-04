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
