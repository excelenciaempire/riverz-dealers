import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureShopifyOrderCustomer } from './order-customer';

afterEach(() => vi.restoreAllMocks());

const order = {
  id: 123,
  phone: '+573187116544',
  customer: null,
  shipping_address: {
    first_name: 'Alicia',
    last_name: 'Torres',
    name: 'Alicia Torres',
    phone: '+573187116544',
  },
};

describe('ensureShopifyOrderCustomer', () => {
  it('crea el cliente y lo vincula al pedido cuando Shopify lo dejó vacío', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ customers: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            customer: {
              id: 456,
              first_name: 'Alicia',
              last_name: 'Torres',
              phone: '+573187116544',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              orderCustomerSet: {
                order: {
                  customer: {
                    id: 'gid://shopify/Customer/456',
                    first_name: 'Alicia',
                  },
                },
                userErrors: [],
              },
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      ensureShopifyOrderCustomer({
        shopDomain: 'example.myshopify.com',
        accessToken: 'secret',
        order,
      })
    ).resolves.toMatchObject({ status: 'created_and_linked' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const createBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(createBody.customer).toMatchObject({
      first_name: 'Alicia',
      last_name: 'Torres',
      phone: '+573187116544',
    });
  });

  it('reutiliza un cliente existente por teléfono', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            customers: [{ id: 456, phone: '+573187116544' }],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              orderCustomerSet: {
                order: { customer: { id: 'gid://shopify/Customer/456' } },
                userErrors: [],
              },
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      ensureShopifyOrderCustomer({
        shopDomain: 'example.myshopify.com',
        accessToken: 'secret',
        order,
      })
    ).resolves.toMatchObject({ status: 'linked' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no duplica un cliente que ya está vinculado', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      ensureShopifyOrderCustomer({
        shopDomain: 'example.myshopify.com',
        accessToken: 'secret',
        order: { ...order, customer: { id: 456 } },
      })
    ).resolves.toMatchObject({ status: 'already_linked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
