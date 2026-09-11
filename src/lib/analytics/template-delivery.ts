/** Estados que el canal ya confirmó. `sending` sigue en tránsito y `failed`
 * nunca fue aceptado: incluir cualquiera de los dos infla los enviados. */
const CONFIRMED_TEMPLATE_STATUSES = new Set(['sent', 'delivered', 'read']);

export interface TemplateDeliveryCounts {
  sent: number;
  delivered: number;
  read: number;
}

export function summarizeConfirmedTemplateDelivery(
  rows: Array<{ status: string | null }>,
): TemplateDeliveryCounts | null {
  const confirmed = rows.filter((row) =>
    CONFIRMED_TEMPLATE_STATUSES.has(String(row.status ?? '')),
  );
  if (confirmed.length === 0) return null;
  return {
    sent: confirmed.length,
    delivered: confirmed.filter(
      (row) => row.status === 'delivered' || row.status === 'read',
    ).length,
    read: confirmed.filter((row) => row.status === 'read').length,
  };
}
