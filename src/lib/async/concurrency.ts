/**
 * Ejecuta trabajo independiente con concurrencia acotada y conserva el orden.
 *
 * Los barridos globales reciben conexiones de todos los comercios. Ejecutarlas
 * una por una hace que una cuenta lenta retrase a las demás; lanzar un
 * Promise.all sin límite cambia ese problema por rate limits del proveedor.
 */
export const DEFAULT_CONNECTION_CONCURRENCY = 3;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('concurrency limit must be a positive integer');
  }

  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run())
  );
  return results;
}

export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  await mapWithConcurrency(items, limit, worker);
}
