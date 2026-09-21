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
  /** El permiso que Shopify pidió, cuando `error` es `missing_scope`. */
  scope?: string;
}

export interface ReplacementOrderItem {
  variantId: string;
  quantity: number;
  /** La oferta cubre esta línea por completo, por ejemplo el segundo par gratis. */
  free?: boolean;
}

export interface ReplaceOrderItemsResult {
  ok: boolean;
  items?: Array<{ variantId: string; quantity: number; free: boolean }>;
  verifiedItems?: Array<{
    variantId: string;
    quantity: number;
    title: string;
    variantTitle: string;
  }>;
  total?: { amount: string; currencyCode: string };
  tags?: string[];
  error?: string;
  scope?: string;
}

/**
 * Un permiso que falta no es un fallo transitorio.
 *
 * Shopify contesta 200 con `errors[].extensions.code = ACCESS_DENIED` cuando la
 * tienda no otorgó el scope. Este archivo descartaba `errors` entero y devolvía
 * `null`, así que la capa de arriba lo leía como "la edición falló" y le pedía
 * al agente que ofreciera revisarlo — sobre un permiso que ninguna tienda iba a
 * conceder sola. Separarlo es lo que permite decir "reconecta la tienda".
 */
export function faltaPermiso(errores: unknown): string | null {
  if (!Array.isArray(errores)) return null;
  for (const e of errores) {
    const ext = (e as { extensions?: { code?: string; requiredAccess?: string } })?.extensions;
    if (ext?.code === 'ACCESS_DENIED') {
      return ext.requiredAccess || (e as { message?: string })?.message || 'ACCESS_DENIED';
    }
  }
  return null;
}

async function gql(
  admin: ShopifyAdmin,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; permiso: string | null }> {
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
    if (!res.ok) return { data: null, permiso: null };
    const json = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown };
    return { data: json.data ?? null, permiso: faltaPermiso(json.errors) };
  } catch {
    return { data: null, permiso: null };
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
  const beginRes = await gql(admin, beginQuery, { id: orderGid });
  if (beginRes.permiso) return { ok: false, error: 'missing_scope', scope: beginRes.permiso };
  const begin = beginRes.data as
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
  const setRes = await gql(
    admin,
    `mutation($id:ID!,$lineItemId:ID!,$qty:Int!){ orderEditSetQuantity(id:$id, lineItemId:$lineItemId, quantity:$qty, restock:false){ calculatedOrder{ id subtotalPriceSet{ shopMoney{ amount } } } userErrors{ message } } }`,
    { id: calc.id, lineItemId: first.id, qty: newQty },
  );
  if (setRes.permiso) return { ok: false, error: 'missing_scope', scope: setRes.permiso };
  const setQ = setRes.data as
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
  const commitRes = await gql(
    admin,
    `mutation($id:ID!){ orderEditCommit(id:$id, notifyCustomer:false, staffNote:"Unidades agregadas por el agente de Riverz"){ order{ id } userErrors{ message } } }`,
    { id: calc.id },
  );
  if (commitRes.permiso) return { ok: false, error: 'missing_scope', scope: commitRes.permiso };
  const commit = commitRes.data as
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

/**
 * Sustituye todas las líneas no despachadas por las variantes confirmadas y
 * conserva promociones como “segundo par gratis” mediante un descuento del
 * 100 % sobre las líneas marcadas como gratuitas.
 */
export async function replaceUnfulfilledOrderItems(
  admin: ShopifyAdmin,
  orderId: string | number,
  requested: ReplacementOrderItem[],
  staffNote = 'Variantes corregidas por Riverz tras confirmación del cliente',
): Promise<ReplaceOrderItemsResult> {
  const grouped = new Map<string, { variantId: string; quantity: number; free: boolean }>();
  for (const item of requested) {
    const variantId = String(item.variantId ?? '').replace(/\D/g, '');
    const quantity = Math.floor(Number(item.quantity));
    if (!variantId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 20) {
      return { ok: false, error: 'invalid_items' };
    }
    const key = `${variantId}:${item.free === true ? 'free' : 'paid'}`;
    const existing = grouped.get(key);
    grouped.set(key, {
      variantId,
      quantity: (existing?.quantity ?? 0) + quantity,
      free: item.free === true,
    });
  }
  const items = [...grouped.values()];
  if (!items.length || items.length > 20) return { ok: false, error: 'invalid_items' };

  const orderGid = `gid://shopify/Order/${orderId}`;
  const preflightRes = await gql(
    admin,
    `query($id:ID!){order(id:$id){id cancelledAt displayFulfillmentStatus lineItems(first:100){nodes{quantity currentQuantity unfulfilledQuantity}}}}`,
    { id: orderGid },
  );
  if (preflightRes.permiso) {
    return { ok: false, error: 'missing_scope', scope: preflightRes.permiso };
  }
  const preflight = preflightRes.data as {
    order?: {
      id?: string;
      cancelledAt?: string | null;
      displayFulfillmentStatus?: string | null;
      lineItems?: {
        nodes?: Array<{
          quantity?: number;
          currentQuantity?: number;
          unfulfilledQuantity?: number;
        }>;
      };
    };
  } | null;
  const liveOrder = preflight?.order;
  if (!liveOrder?.id) return { ok: false, error: 'order_not_found' };
  if (liveOrder.cancelledAt) return { ok: false, error: 'order_cancelled' };
  const alreadyFulfilled = (liveOrder.lineItems?.nodes ?? []).some((line) => {
    const current = Math.max(0, Number(line.currentQuantity ?? line.quantity ?? 0));
    const unfulfilled = Math.max(0, Number(line.unfulfilledQuantity ?? current));
    return current > unfulfilled;
  });
  if (alreadyFulfilled || (liveOrder.displayFulfillmentStatus ?? '').toUpperCase() === 'FULFILLED') {
    return { ok: false, error: 'order_already_fulfilled' };
  }

  const beginRes = await gql(
    admin,
    `mutation($id:ID!){orderEditBegin(id:$id){calculatedOrder{id lineItems(first:100){nodes{id quantity}}} userErrors{message}}}`,
    { id: orderGid },
  );
  if (beginRes.permiso) return { ok: false, error: 'missing_scope', scope: beginRes.permiso };
  const begin = beginRes.data as {
    orderEditBegin?: {
      calculatedOrder?: { id?: string; lineItems?: { nodes?: Array<{ id?: string; quantity?: number }> } };
      userErrors?: Array<{ message?: string }>;
    };
  } | null;
  const calculatedOrder = begin?.orderEditBegin?.calculatedOrder;
  if (!calculatedOrder?.id) {
    return {
      ok: false,
      error: begin?.orderEditBegin?.userErrors?.[0]?.message ?? 'order_edit_begin_failed',
    };
  }

  for (const line of calculatedOrder.lineItems?.nodes ?? []) {
    if (!line.id || !line.quantity) continue;
    const removed = await gql(
      admin,
      `mutation($id:ID!,$lineItemId:ID!){orderEditSetQuantity(id:$id,lineItemId:$lineItemId,quantity:0,restock:true){userErrors{message}}}`,
      { id: calculatedOrder.id, lineItemId: line.id },
    );
    if (removed.permiso) return { ok: false, error: 'missing_scope', scope: removed.permiso };
    const payload = removed.data as {
      orderEditSetQuantity?: { userErrors?: Array<{ message?: string }> };
    } | null;
    if (payload?.orderEditSetQuantity?.userErrors?.length) {
      return { ok: false, error: payload.orderEditSetQuantity.userErrors[0].message ?? 'remove_failed' };
    }
  }

  for (const item of items) {
    const added = await gql(
      admin,
      `mutation($id:ID!,$variantId:ID!,$quantity:Int!){orderEditAddVariant(id:$id,variantId:$variantId,quantity:$quantity,allowDuplicates:true){calculatedLineItem{id} userErrors{message}}}`,
      {
        id: calculatedOrder.id,
        variantId: `gid://shopify/ProductVariant/${item.variantId}`,
        quantity: item.quantity,
      },
    );
    if (added.permiso) return { ok: false, error: 'missing_scope', scope: added.permiso };
    const payload = added.data as {
      orderEditAddVariant?: {
        calculatedLineItem?: { id?: string };
        userErrors?: Array<{ message?: string }>;
      };
    } | null;
    const lineItemId = payload?.orderEditAddVariant?.calculatedLineItem?.id;
    if (!lineItemId || payload?.orderEditAddVariant?.userErrors?.length) {
      return {
        ok: false,
        error: payload?.orderEditAddVariant?.userErrors?.[0]?.message ?? 'add_variant_failed',
      };
    }
    if (item.free) {
      const discounted = await gql(
        admin,
        `mutation($id:ID!,$lineItemId:ID!){orderEditAddLineItemDiscount(id:$id,lineItemId:$lineItemId,discount:{description:"Oferta: segundo producto gratis",percentValue:100}){addedDiscountStagedChange{id} userErrors{message}}}`,
        { id: calculatedOrder.id, lineItemId },
      );
      if (discounted.permiso) {
        return { ok: false, error: 'missing_scope', scope: discounted.permiso };
      }
      const discountPayload = discounted.data as {
        orderEditAddLineItemDiscount?: {
          addedDiscountStagedChange?: { id?: string };
          userErrors?: Array<{ message?: string }>;
        };
      } | null;
      if (
        !discountPayload?.orderEditAddLineItemDiscount?.addedDiscountStagedChange?.id ||
        discountPayload.orderEditAddLineItemDiscount.userErrors?.length
      ) {
        return {
          ok: false,
          error:
            discountPayload?.orderEditAddLineItemDiscount?.userErrors?.[0]?.message ??
            'discount_failed',
        };
      }
    }
  }

  const committed = await gql(
    admin,
    `mutation($id:ID!,$note:String!){orderEditCommit(id:$id,notifyCustomer:false,staffNote:$note){order{id} userErrors{message}}}`,
    { id: calculatedOrder.id, note: staffNote.slice(0, 255) },
  );
  if (committed.permiso) return { ok: false, error: 'missing_scope', scope: committed.permiso };
  const commitPayload = committed.data as {
    orderEditCommit?: { order?: { id?: string }; userErrors?: Array<{ message?: string }> };
  } | null;
  if (!commitPayload?.orderEditCommit?.order?.id) {
    return {
      ok: false,
      error: commitPayload?.orderEditCommit?.userErrors?.[0]?.message ?? 'order_edit_commit_failed',
    };
  }

  // Shopify accepted the edit, but the customer must only hear that the order
  // was corrected after a fresh read proves which active variants remain.
  const verifyRes = await gql(
    admin,
    `query($id:ID!){order(id:$id){id tags totalPriceSet{shopMoney{amount currencyCode}} lineItems(first:100){nodes{title variantTitle currentQuantity variant{id}}}}}`,
    { id: orderGid },
  );
  if (verifyRes.permiso) {
    return { ok: false, error: 'updated_but_unverified', scope: verifyRes.permiso };
  }
  const verifiedOrder = verifyRes.data as {
    order?: {
      id?: string;
      tags?: string[];
      totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
      lineItems?: {
        nodes?: Array<{
          title?: string;
          variantTitle?: string;
          currentQuantity?: number;
          variant?: { id?: string } | null;
        }>;
      };
    };
  } | null;
  if (!verifiedOrder?.order?.id) return { ok: false, error: 'updated_but_unverified' };
  const verifiedItems = (verifiedOrder.order.lineItems?.nodes ?? [])
    .map((line) => ({
      variantId: String(line.variant?.id ?? '').replace(/\D/g, ''),
      quantity: Math.max(0, Math.floor(Number(line.currentQuantity ?? 0))),
      title: String(line.title ?? ''),
      variantTitle: String(line.variantTitle ?? ''),
    }))
    .filter((line) => line.variantId && line.quantity > 0);
  const requestedQuantities = new Map<string, number>();
  for (const item of items) {
    requestedQuantities.set(
      item.variantId,
      (requestedQuantities.get(item.variantId) ?? 0) + item.quantity,
    );
  }
  const verifiedQuantities = new Map<string, number>();
  for (const item of verifiedItems) {
    verifiedQuantities.set(
      item.variantId,
      (verifiedQuantities.get(item.variantId) ?? 0) + item.quantity,
    );
  }
  const exact =
    requestedQuantities.size === verifiedQuantities.size &&
    [...requestedQuantities].every(
      ([variantId, quantity]) => verifiedQuantities.get(variantId) === quantity,
    );
  if (!exact) {
    return { ok: false, error: 'updated_but_verification_mismatch', verifiedItems };
  }
  const money = verifiedOrder.order.totalPriceSet?.shopMoney;
  return {
    ok: true,
    items,
    verifiedItems,
    tags: Array.isArray(verifiedOrder.order.tags) ? verifiedOrder.order.tags : [],
    ...(money?.amount && money.currencyCode
      ? { total: { amount: money.amount, currencyCode: money.currencyCode } }
      : {}),
  };
}
