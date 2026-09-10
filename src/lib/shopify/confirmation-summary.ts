/** Single-line template parameters: all items, variants and delivery details. */
export function confirmationSummary(
  order: Record<string, unknown>
): Record<string, string> {
  const clean = (value: unknown) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const shipping = (order.shipping_address ?? {}) as Record<string, unknown>;
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  return {
    order_items:
      items
        .map((item: Record<string, unknown>) => {
          const variant = clean(item.variant_title);
          const properties = Array.isArray(item.properties)
            ? (item.properties as Array<Record<string, unknown>>).flatMap(
                (property) => {
                  const name = clean(property.name);
                  const value = clean(property.value);
                  // Shopify usa propiedades con “_” para datos internos de apps.
                  return name && value && !name.startsWith('_')
                    ? [`${name}: ${value}`]
                    : [];
                }
              )
            : [];
          const details = [
            variant && variant !== 'Default Title' ? variant : '',
            ...properties,
          ].filter(Boolean);
          return `${clean(item.quantity)} × ${clean(item.title)}${details.length ? ` (${details.join(', ')})` : ''}`;
        })
        .join('; ') || '—',
    delivery_address:
      [shipping.address1, shipping.address2, shipping.city, shipping.province]
        .map(clean)
        .filter(Boolean)
        .join(', ') || '—',
    delivery_phone: clean(shipping.phone || order.phone) || '—',
    recipient_name:
      clean(
        shipping.name ||
          [shipping.first_name, shipping.last_name].filter(Boolean).join(' ')
      ) || '—',
  };
}
