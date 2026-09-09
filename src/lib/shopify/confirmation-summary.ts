/** Single-line template parameters: all items, variants and delivery details. */
export function confirmationSummary(order: Record<string, unknown>): Record<string, string> {
  const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const shipping = (order.shipping_address ?? {}) as Record<string, unknown>;
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  return {
    order_items: items.map((item: Record<string, unknown>) => {
      const variant = clean(item.variant_title);
      return `${clean(item.quantity)} × ${clean(item.title)}${variant && variant !== 'Default Title' ? ` (${variant})` : ''}`;
    }).join('; ') || '—',
    delivery_address: [shipping.address1, shipping.address2, shipping.city, shipping.province]
      .map(clean).filter(Boolean).join(', ') || '—',
    delivery_phone: clean(shipping.phone || order.phone) || '—',
    recipient_name: clean(shipping.name || [shipping.first_name, shipping.last_name].filter(Boolean).join(' ')) || '—',
  };
}
