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
  const visibleVariant = (item: Record<string, unknown>) => {
    const title = clean(item.title);
    const explicit = clean(item.variant_title);
    if (explicit && explicit.toLowerCase() !== 'default title') return explicit;

    // Shopify conserva normalmente `name = "Producto - Variante"` aunque la
    // variante se elimine después de la compra y `variant_title` llegue vacío.
    // Ese respaldo evita perder justo la selección que el cliente debe revisar.
    const fullName = clean(item.name);
    const prefix = title ? `${title} - ` : '';
    if (prefix && fullName.toLowerCase().startsWith(prefix.toLowerCase())) {
      const inferred = clean(fullName.slice(prefix.length));
      if (inferred && inferred.toLowerCase() !== 'default title') return inferred;
    }
    return '';
  };
  return {
    order_items:
      items
        .map((item: Record<string, unknown>) => {
          const title = clean(item.title) || clean(item.name) || '—';
          const variant = visibleVariant(item);
          const properties = Array.isArray(item.properties)
            ? (item.properties as Array<Record<string, unknown>>).flatMap(
                (property) => {
                  const name = clean(property.name ?? property.key);
                  const value = clean(property.value);
                  // Shopify usa propiedades con “_” para datos internos de apps.
                  return name && value && !name.startsWith('_')
                    ? [`${name}: ${value}`]
                    : [];
                }
              )
            : [];
          const details = [variant, ...properties].filter(
            (detail, index, all) =>
              detail &&
              all.findIndex(
                (candidate) => candidate.toLowerCase() === detail.toLowerCase()
              ) === index
          );
          return `${clean(item.quantity) || '1'} × ${title}${details.length ? ` (${details.join(', ')})` : ''}`;
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
