import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateGoogleAddress,validateWorkspaceShippingAddress } from './google-validation';
import type { SupabaseClient } from '@supabase/supabase-js';

function googleResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Google Address Validation para pedidos contraentrega', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normaliza silenciosamente una dirección completa y precisa', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      googleResponse({
        responseId: 'validation-1',
        result: {
          verdict: {
            validationGranularity: 'PREMISE',
            addressComplete: true,
            possibleNextAction: 'ACCEPT',
            hasUnconfirmedComponents: false,
            hasSpellCorrectedComponents: true,
          },
          address: {
            formattedAddress: 'Carrera 7 #71-21, Bogotá, Colombia',
            postalAddress: {
              regionCode: 'CO',
              administrativeArea: 'Bogotá D.C.',
              locality: 'Bogotá',
              addressLines: ['Carrera 7 # 71-21'],
            },
            missingComponentTypes: ['postal_code'],
          },
        },
      })
    );

    await expect(
      validateGoogleAddress('key', {
        address1: 'cra 7 71 21',
        address2: 'Apto 302',
        city: 'Bogota',
        country: 'Colombia',
      })
    ).resolves.toEqual({
      status: 'accept',
      responseId: 'validation-1',
      formattedAddress: 'Carrera 7 #71-21, Bogotá, Colombia',
      address: {
        address1: 'Carrera 7 # 71-21',
        address2: 'Apto 302',
        city: 'Bogotá',
        province: 'Bogotá D.C.',
        zip: undefined,
        country: 'Colombia',
      },
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('addressvalidation.googleapis.com');
    const sent = JSON.parse(String(request?.body));
    expect(sent.address).toMatchObject({
      regionCode: 'CO',
      locality: 'Bogota',
    });
  });

  it('pide confirmar sólo cuando Google devuelve una coincidencia dudosa', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      googleResponse({
        result: {
          verdict: {
            validationGranularity: 'ROUTE',
            addressComplete: true,
            possibleNextAction: 'CONFIRM',
          },
          address: {
            formattedAddress: 'Calle 10, Medellín, Colombia',
            postalAddress: { locality: 'Medellín', addressLines: ['Calle 10'] },
          },
        },
      })
    );

    await expect(
      validateGoogleAddress('key', {
        address1: 'calle 10',
        city: 'Medellin',
        country: 'Colombia',
      })
    ).resolves.toMatchObject({
      status: 'confirm',
      formattedAddress: 'Calle 10, Medellín, Colombia',
    });
  });

  it('señala exactamente los componentes que deben corregirse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      googleResponse({
        result: {
          verdict: {
            validationGranularity: 'OTHER',
            possibleNextAction: 'FIX',
            hasUnconfirmedComponents: true,
          },
          address: {
            formattedAddress: 'Cúcuta, Norte de Santander, Colombia',
            postalAddress: { locality: 'Cúcuta', addressLines: [] },
            missingComponentTypes: ['street_number', 'route'],
          },
        },
      })
    );

    await expect(
      validateGoogleAddress('key', {
        address1: 'Brisas de Torcorroma',
        city: 'Cúcuta',
        country: 'Colombia',
      })
    ).resolves.toMatchObject({
      status: 'fix',
      missing: ['número de la dirección', 'calle o carrera'],
    });
  });

  it('detecta campos básicos faltantes antes de gastar una llamada', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      validateGoogleAddress('key', { city: 'Cúcuta' })
    ).resolves.toEqual({
      status: 'fix',
      reasons: ['calle y número'],
      missing: ['calle y número'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distingue una caída de Google de una dirección incorrecta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      googleResponse(
        {
          error: { status: 'PERMISSION_DENIED' },
        },
        403
      )
    );
    await expect(
      validateGoogleAddress('bad-key', {
        address1: 'Carrera 7 # 71-21',
        city: 'Bogotá',
      })
    ).resolves.toEqual({ status: 'unavailable', reason: 'PERMISSION_DENIED' });
  });
  it('passes any two-letter country to Google and distinguishes an unreadable configuration from a disabled integration',async () => {
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(googleResponse({ error:{ status:'PERMISSION_DENIED' } },403));
    const address={ address1:'20 Main St',city:'Berlin',country:'DE' };
    await validateGoogleAddress('test-key',address);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).address.regionCode).toBe('DE');
    const configuration=(data:unknown,error:unknown) => {
      const q={ select:() => q,eq:() => q,maybeSingle:async () => ({ data,error }) };
      return { from:() => q } as unknown as SupabaseClient;
    };
    expect(await validateWorkspaceShippingAddress('ws',address,configuration(null,{ message:'database unavailable' }))).toEqual({ status:'unavailable',reason:'configuration_unavailable' });
    expect(await validateWorkspaceShippingAddress('ws',address,configuration(null,null))).toEqual({ status:'disabled',address });
    expect(await validateWorkspaceShippingAddress('ws',address,configuration({ is_active:false },null))).toEqual({ status:'disabled',address });
  });
  it('refuses a provider match in a different country instead of silently combining their fields',async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue(googleResponse({ result:{ verdict:{ addressComplete:true,validationGranularity:'PREMISE',possibleNextAction:'ACCEPT' },address:{ postalAddress:{ regionCode:'MX',locality:'Mexico City',addressLines:['20 Main St'] } } } }));
    expect(await validateGoogleAddress('test-key',{ address1:'20 Main St',city:'Austin',country:'US' })).toMatchObject({ status:'fix' });
  });
});
