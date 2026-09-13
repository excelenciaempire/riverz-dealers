import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { isVoiceAdmin } from '@/lib/voice/voice-connection-store';
import { createAddress, TelnyxApiError } from '@/lib/voice/telnyx-numbers';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/voice/numbers/address
 *   { workspace_id, first_name?, last_name?, business_name?, street_address,
 *     locality, administrative_area?, postal_code?, country_code, ... }
 * Creates a Telnyx address → returns its id, used as an address requirement's
 * field_value. Admin-only.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | ({ workspace_id?: string } & Record<string, unknown>)
    | null;
  if (!body?.workspace_id || !body.street_address || !body.country_code) {
    return NextResponse.json(
      { error: 'workspace_id, street_address and country_code required' },
      { status: 400 },
    );
  }
  if (!(await isVoiceAdmin(user.id, body.workspace_id)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Only forward known address fields to Telnyx.
  const allow = [
    'first_name',
    'last_name',
    'business_name',
    'phone_number',
    'street_address',
    'extended_address',
    'locality',
    'administrative_area',
    'postal_code',
    'country_code',
    'neighborhood',
    'borough',
  ];
  const fields: Record<string, unknown> = { customer_reference: body.workspace_id };
  for (const k of allow) if (body[k] != null && body[k] !== '') fields[k] = body[k];

  try {
    const addr = await createAddress(fields);
    return NextResponse.json({ address_id: addr.id });
  } catch (err) {
    if (err instanceof TelnyxApiError && [400, 422].includes(err.status)) {
      return NextResponse.json({
        error: translate(await getLocale(), 'voice.addressValidationFailed'),
        provider_code: err.code,
        field: err.field,
      }, { status: 422 });
    }
    return serverError(err, 'address creation failed');
  }
}
