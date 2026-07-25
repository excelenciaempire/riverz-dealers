/**
 * Shopify order editing for in-call upsell (COD confirmation).
 *
 * Adds units to an existing order's first line item via the Admin GraphQL
 * orderEdit flow (begin → setQuantity → commit). Returns the extra revenue so
 * the voice layer can record it. Fail-soft; never throws.
 */
import type { ShopifyAdmin } from './order-tags';

interface AddUnitsResult {
  ok: boolean;
  added_units?: number;
  added_amount?: number;
  error?: string;
}

async function gql(
  admin: ShopifyAdmin,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `https://${admin.shopDomain}/admin/api/${admin.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': admin.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Add `addUnits` to the FIRST line item of an order. `orderId` is the numeric
 * REST id; converted to a GraphQL gid internally.
 */
export async function addUnitsToFirstLineItem(
  admin: ShopifyAdmin,
  orderId: string | number,
  addUnits: number,
): Promise<AddUnitsResult> {
  const units = Math.floor(Number(addUnits));
  if (!Number.isFinite(units) || units <= 0) return { ok: false, error: 'invalid_units' };
  const orderGid = `gid://shopify/Order/${orderId}`;

  // 1) Begin the edit → get the calculated order + its first line item.
  const beginQuery = `mutation($id:ID!){
    orderEditBegin(id:$id){
      calculatedOrder{ id lineItems(first:1){ edges{ node{ id quantity } } } }
      userErrors{ message }
    }
  }`;
  const begin = (await gql(admin, beginQuery, { id: orderGid })) as
    | {
        orderEditBegin?: {
          calculatedOrder?: {
            id: string;
            lineItems?: { edges: { node: { id: string; quantity: number } }[] };
          };
          userErrors?: { message: string }[];
        };
      }
    | null;

  const calc = begin?.orderEditBegin?.calculatedOrder;
  const first = calc?.lineItems?.edges?.[0]?.node;
  if (!calc?.id || !first?.id) {
    return { ok: false, error: 'order_edit_begin_failed' };
  }

  // 2) Set the new absolute quantity (current + added). restock=false: we're
  //    selling more, not returning.
  const newQty = (first.quantity ?? 0) + units;
  const setQ = (await gql(
    admin,
    `mutation($id:ID!,$lineItemId:ID!,$qty:Int!){ orderEditSetQuantity(id:$id, lineItemId:$lineItemId, quantity:$qty, restock:false){ calculatedOrder{ id subtotalPriceSet{ shopMoney{ amount } } } userErrors{ message } } }`,
    { id: calc.id, lineItemId: first.id, qty: newQty },
  )) as
    | {
        orderEditSetQuantity?: {
          calculatedOrder?: { subtotalPriceSet?: { shopMoney?: { amount?: string } } };
          userErrors?: { message: string }[];
        };
      }
    | null;
  if (setQ?.orderEditSetQuantity?.userErrors?.length) {
    return { ok: false, error: setQ.orderEditSetQuantity.userErrors[0].message };
  }

  // 3) Commit.
  const commit = (await gql(
    admin,
    `mutation($id:ID!){ orderEditCommit(id:$id, notifyCustomer:false, staffNote:"Upsell por llamada IA"){ order{ id } userErrors{ message } } }`,
    { id: calc.id },
  )) as
    | { orderEditCommit?: { order?: { id: string }; userErrors?: { message: string }[] } }
    | null;
  if (!commit?.orderEditCommit?.order?.id) {
    return {
      ok: false,
      error: commit?.orderEditCommit?.userErrors?.[0]?.message ?? 'order_edit_commit_failed',
    };
  }

  return { ok: true, added_units: units };
}
