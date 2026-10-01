/** Bound complete read-only previews instead of silently accepting REST caps. */
export async function readSimulationRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maximum = 10000,
): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; ; start += 500) {
    const result = await page(start, start + 499)
    if (result.error || !Array.isArray(result.data)) throw new Error('automation_simulation_unavailable')
    if (rows.length + result.data.length > maximum) throw new Error('automation_simulation_too_large')
    rows.push(...result.data)
    if (result.data.length < 500) return rows
  }
}
