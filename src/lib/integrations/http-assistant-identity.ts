import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { esCasillaDeRol, esTelefonoDeRelleno, sirveParaUnir } from '@/lib/contacts/identidad-probada';
import type { HttpActionBindings, HttpActionDefinition } from './http-action-contract';

const contact = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(),
  phone: z.string().nullable(), email: z.string().nullable(), phone_origen: z.string().nullable(),
  email_origen: z.string().nullable(), union_bloqueada: z.boolean() }).strict();

/** Binding eligibility follows existing contact provenance rules; it is not proof of external record ownership.
 * Preserve the raw snapshot for receipt/approval equality. SQL rechecks provenance under a contact lock.
 */
export async function httpAssistantIdentityAllowed(db: SupabaseClient, workspaceId: string,
  bindings: HttpActionBindings, channel: string, definition: HttpActionDefinition): Promise<boolean> {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return false;
  const sources = definition.parameters.filter(p => p.source === 'phone' || p.source === 'email');
  if (!sources.length) return true;
  if (!z.string().uuid().safeParse(workspaceId).success || !z.string().uuid().safeParse(bindings.contact_id).success) return false;
  try {
    const result = await db.from('contacts').select('id, workspace_id, phone, email, phone_origen, email_origen, union_bloqueada')
      .eq('workspace_id', workspaceId).eq('id', bindings.contact_id!).maybeSingle();
    const parsed = contact.safeParse(result.data);
    if (result.error || !parsed.success) return false;
    const c = parsed.data;
    if (c.id !== bindings.contact_id || c.workspace_id !== workspaceId || c.phone !== bindings.phone || c.email !== bindings.email) return false;
    return sources.every(p => {
      const source = p.source as 'phone' | 'email', raw = c[source];
      if (raw === null) return !p.required;
      if (channel === 'webchat' || c.union_bloqueada || !sirveParaUnir(c[`${source}_origen`])) return false;
      const value = raw.trim();
      return source === 'phone' ? !!value && !esTelefonoDeRelleno(value)
        : !!value && value.includes('@') && !esCasillaDeRol(value);
    });
  } catch { return false; }
}
