import { ShopifyAdminClient } from './admin-client';
import { shopifyApiVersion } from './oauth';

interface ShopifyCustomer {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export type OrderCustomerResult =
  | { status: 'already_linked'; customer: Record<string, unknown> }
  | { status: 'linked' | 'created_and_linked'; customer: ShopifyCustomer }
  | { status: 'missing_identity' | 'failed'; customer: null };

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(value: string): { first_name: string; last_name: string } {
  const parts = value.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] ?? '',
    last_name: parts.slice(1).join(' '),
  };
}

/**
 * Vincula los pedidos creados por formularios/app proxies con un Customer de
 * Shopify. Tener teléfono y dirección en el pedido no basta: si `customer` es
 * null, Shopify muestra “Sin cliente” y no acumula su historial de compras.
 *
 * Es idempotente: primero busca por email/teléfono, crea sólo si no encuentra
 * y finalmente usa `orderCustomerSet`, la mutación específica de Shopify.
 */
export async function ensureShopifyOrderCustomer(args: {
  shopDomain: string;
  accessToken: string;
  order: Record<string, unknown>;
}): Promise<OrderCustomerResult> {
  const existing = args.order.customer;
  if (
    existing &&
    typeof existing === 'object' &&
    clean((existing as Record<string, unknown>).id)
  ) {
    return {
      status: 'already_linked',
      customer: existing as Record<string, unknown>,
    };
  }

  const shipping = (args.order.shipping_address ?? {}) as Record<
    string,
    unknown
  >;
  const email = clean(args.order.email || shipping.email);
  const phone = clean(args.order.phone || shipping.phone);
  const fullName = clean(
    shipping.name ||
      [shipping.first_name, shipping.last_name].filter(Boolean).join(' ')
  );
  if (!email && !phone) return { status: 'missing_identity', customer: null };

  const client = new ShopifyAdminClient(args.shopDomain, args.accessToken);
  const query = email ? `email:${email}` : `phone:${phone}`;
  let customer: ShopifyCustomer | null = null;

  try {
    const found = await client.rest<{ customers?: ShopifyCustomer[] }>(
      `/customers/search.json?query=${encodeURIComponent(query)}&limit=5`
    );
    customer = found.customers?.[0] ?? null;

    if (!customer) {
      const name = splitName(fullName);
      const created = await client.rest<{ customer?: ShopifyCustomer }>(
        '/customers.json',
        {
          method: 'POST',
          body: {
            customer: {
              ...(name.first_name ? { first_name: name.first_name } : {}),
              ...(name.last_name ? { last_name: name.last_name } : {}),
              ...(email ? { email } : {}),
              ...(phone ? { phone } : {}),
              verified_email: false,
            },
          },
        }
      );
      customer = created.customer ?? null;
    }
    if (!customer?.id) return { status: 'failed', customer: null };

    const response = await fetch(
      `https://${args.shopDomain}/admin/api/${shopifyApiVersion()}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': args.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `mutation SetOrderCustomer($orderId: ID!, $customerId: ID!) {
            orderCustomerSet(orderId: $orderId, customerId: $customerId) {
              order { id customer { id firstName lastName email phone } }
              userErrors { field message }
            }
          }`,
          variables: {
            orderId: `gid://shopify/Order/${clean(args.order.id)}`,
            customerId: String(customer.id).startsWith('gid://')
              ? String(customer.id)
              : `gid://shopify/Customer/${customer.id}`,
          },
        }),
      }
    );
    if (!response.ok) return { status: 'failed', customer: null };
    const result = (await response.json()) as {
      data?: {
        orderCustomerSet?: {
          order?: { customer?: ShopifyCustomer | null } | null;
          userErrors?: Array<{ message?: string }>;
        };
      };
    };
    const payload = result.data?.orderCustomerSet;
    if (payload?.userErrors?.length || !payload?.order?.customer) {
      return { status: 'failed', customer: null };
    }

    const wasCreated = !found.customers?.[0];
    return {
      status: wasCreated ? 'created_and_linked' : 'linked',
      customer: payload.order.customer,
    };
  } catch {
    return { status: 'failed', customer: null };
  }
}
