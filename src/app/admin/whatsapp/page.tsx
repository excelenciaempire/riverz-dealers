'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageCircle, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { WhatsAppEmbeddedSignup } from '@/components/settings/whatsapp-embedded-signup';

interface Status {
  configured: boolean;
  active: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  templateName: string | null;
  templateLanguage: string;
  hasToken: boolean;
  updatedAt: string | null;
  needsMigration: boolean;
}

/**
 * El WhatsApp de Riverz, no el de un comercio.
 *
 * Vive acá y no en Integraciones porque no es de un inquilino: es el número
 * con el que la plataforma le escribe a los dueños de los comercios cuando
 * algo se rompe. Si saliera por el número del propio comercio, el aviso "tu
 * WhatsApp está bloqueado" sería el único que nunca llega.
 *
 * El token se escribe pero no se lee: la pantalla sólo dice si hay uno puesto.
 */
export default function AdminWhatsAppPage() {
  const fetchWithCsrf = useFetchWithCsrf();
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('');
  const [token, setToken] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [isActive, setIsActive] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/whatsapp', { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as Status;
    setStatus(json);
    setPhoneNumberId(json.phoneNumberId ?? '');
    setWabaId(json.wabaId ?? '');
    setDisplayPhoneNumber(json.displayPhoneNumber ?? '');
    setTemplateName(json.templateName ?? '');
    setIsActive(json.active);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/admin/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId,
          wabaId,
          displayPhoneNumber,
          token,
          templateName,
          templateLanguage: 'es',
          isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo guardar');
        return;
      }
      setStatus(json as Status);
      setToken('');
      toast.success('Guardado');
    } finally {
      setSaving(false);
    }
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-5 text-foreground" />
        <h1 className="text-xl font-semibold text-foreground">WhatsApp de Riverz</h1>
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">
        El número con el que la plataforma le avisa a los comercios cuando algo se
        rompe. Es aparte del de cada cuenta a propósito: el aviso más importante es
        justo el que el número del comercio no podría entregar.
      </p>

      {status.needsMigration && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Falta aplicar la migración <code>147_platform_whatsapp.sql</code>. Hasta
            entonces sólo se puede configurar por variables de entorno
            (<code>PLATFORM_WHATSAPP_PHONE_ID</code>, <code>PLATFORM_WHATSAPP_TOKEN</code>).
          </span>
        </div>
      )}

      {/* El camino normal es el mismo registro de Meta que usa un comercio: el
          token lo trae el flujo y nadie lo copia a mano. Los campos de abajo
          quedan como salida de emergencia. */}
      <div className="max-w-2xl space-y-3 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-medium text-foreground">Conectar con Meta</p>
        <p className="text-xs text-muted-foreground">
          Abre el registro de WhatsApp Business de Meta y trae el número y el token
          sin copiar nada. {status.configured ? 'Volver a conectarlo reemplaza el token guardado.' : ''}
        </p>
        <WhatsAppEmbeddedSignup
          workspaceId="platform"
          target="platform"
          label={status.configured ? 'Volver a conectar' : 'Conectar WhatsApp de Riverz'}
          onConnected={() => void load()}
        />
      </div>

      <details className="max-w-2xl rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Cargar los datos a mano
        </summary>
        <div className="mt-4 space-y-4">
        <Field label="ID del número (phone_number_id)" hint="Meta → WhatsApp → API Setup">
          <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
        </Field>
        <Field label="ID de la cuenta de WhatsApp Business (WABA)">
          <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
        </Field>
        <Field label="Número, como se muestra" hint="+57 300 000 0000">
          <Input
            value={displayPhoneNumber}
            onChange={(e) => setDisplayPhoneNumber(e.target.value)}
          />
        </Field>
        <Field
          label="Token permanente"
          hint={status.hasToken ? 'Ya hay uno guardado — escribe otro sólo si lo cambias' : 'Token del System User'}
        >
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status.hasToken ? '••••••••' : 'EAAG…'}
          />
        </Field>
        <Field
          label="Plantilla de aviso"
          hint="Utility aprobada. Las Marketing las retiene Meta."
        >
          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </Field>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium text-foreground">Avisar por WhatsApp</p>
            <p className="text-xs text-muted-foreground">
              Apagado, los avisos siguen saliendo sólo por correo.
            </p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <Button onClick={save} disabled={saving} className="w-full">
          {saving && <Loader2 className="size-4 animate-spin" />}
          Guardar
        </Button>
        </div>
      </details>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
