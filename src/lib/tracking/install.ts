import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { armAutomation } from '@/lib/automations/activation';
import { crearPlantilla, resolverWabaYToken } from '@/lib/templates/create';
import { uploadTemplateHeaderMedia } from '@/lib/whatsapp/template-media';
import { TRACKING_EVIDENCE_TEMPLATE } from './evidence-template';

const WORKSPACE_ID = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const USER_ID = '5cc2c562-5843-47c9-abea-4fd7ec9120c3';
const AUTOMATION_ID = '7860c0bb-22fb-4ad4-9b7b-efba77f248b3';

export async function installDeunaTrackingEvidence() {
  const db = supabaseAdmin();
  const definition = TRACKING_EVIDENCE_TEMPLATE;
  const { data: existing, error: templateError } = await db.from('message_templates').select('*')
    .eq('workspace_id', WORKSPACE_ID).eq('name', definition.name).eq('language', definition.language).maybeSingle();
  if (templateError) throw templateError;
  let status = String(existing?.status ?? 'Draft');
  if (!existing || existing.status === 'Draft') {
    const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
    if (!appId) throw new Error('META_APP_ID unavailable');
    const credentials = await resolverWabaYToken(db, WORKSPACE_ID, USER_ID);
    if (!credentials.accessToken) throw new Error('WhatsApp token unavailable');
    const sample = await trackingSampleImage();
    const handle = await uploadTemplateHeaderMedia({
      appId, accessToken: credentials.accessToken,
      file: new File([new Uint8Array(sample)], 'rastreo-ejemplo.jpg', { type: 'image/jpeg' }),
    });
    const created = await crearPlantilla(db, {
      workspaceId: WORKSPACE_ID, userId: USER_ID,
      nombre: definition.name, idioma: definition.language, categoria: definition.category,
      headerType: 'image', headerHandle: handle,
      bodyText: definition.body, bodySamples: [...definition.samples],
      variableFields: { ...definition.variableFields },
      plantillaExistenteId: existing?.id ?? null, enviarAMeta: true,
    });
    if (!created.ok) throw new Error(created.mensaje ?? created.claveI18n);
    status = created.estado;
  }
  const { data: steps, error: stepError } = await db.from('automation_steps').select('id,position,step_type')
    .eq('automation_id', AUTOMATION_ID).is('parent_step_id', null).order('position');
  if (stepError) throw stepError;
  const send = steps?.find((step) => step.position === 1 && step.step_type === 'send_template');
  if (!send) throw new Error('Tracking reminder send step unavailable');
  const updated = await db.from('automation_steps').update({ step_config: {
    template_name: definition.name, language: definition.language, tracking_evidence: true,
    variables: { '1': '{{vars.recipient_name}}', '2': '{{vars.tracking_company}}', '3': '{{vars.tracking_number}}' },
  } }).eq('id', send.id);
  if (updated.error) throw updated.error;
  const activation = await armAutomation(db, AUTOMATION_ID, WORKSPACE_ID);
  return { template: definition.name, status, automation: activation.state, issues: activation.issues };
}

async function trackingSampleImage(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><text x="80" y="150" font-size="54" font-family="Arial" fill="#111827">Estado de tu envío</text><text x="80" y="270" font-size="38" font-family="Arial" fill="#374151">Guía 114015579121</text><text x="80" y="390" font-size="46" font-family="Arial" fill="#047857">En tránsito</text></svg>`) }])
    .jpeg({ quality: 90 }).toBuffer();
}
