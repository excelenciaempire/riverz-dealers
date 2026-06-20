'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';

/**
 * Configuración del checkout IA (por workspace). Define las ofertas de
 * bundle, la moneda, el descuento por transferencia y los métodos de pago
 * que usa la tool `create_checkout` del runner.
 *
 * Lectura para todos los miembros; edición solo para admins (la RLS de
 * `workspace_checkout_config` ya impone admin-only en la escritura).
 */

interface OfferRow {
  key: string;
  label: string;
  qty: string;
  total: string;
  compare_at: string;
}

const emptyOffer = (): OfferRow => ({
  key: '',
  label: '',
  qty: '',
  total: '',
  compare_at: '',
});

export function CheckoutConfigCard() {
  const { isAdmin } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [currency, setCurrency] = useState('');
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferLabel, setTransferLabel] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [defaultVariantId, setDefaultVariantId] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/checkout-config', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setEnabled(!!json.enabled);
        setCurrency(json.currency ?? '');
        setOffers(
          Array.isArray(json.offers)
            ? json.offers.map((o: Record<string, unknown>) => ({
                key: String(o.key ?? ''),
                label: String(o.label ?? ''),
                qty: o.qty == null ? '' : String(o.qty),
                total: o.total == null ? '' : String(o.total),
                compare_at: o.compare_at == null ? '' : String(o.compare_at),
              }))
            : [],
        );
        setTransferAmount(
          json.transfer_discount_amount == null
            ? ''
            : String(json.transfer_discount_amount),
        );
        setTransferLabel(json.transfer_discount_label ?? '');
        setPaymentMethods(
          Array.isArray(json.payment_methods)
            ? json.payment_methods.join(', ')
            : '',
        );
        setDefaultVariantId(json.default_variant_id ?? '');
      }
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateOffer(index: number, patch: Partial<OfferRow>) {
    setOffers((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addOffer() {
    setOffers((rows) => [...rows, emptyOffer()]);
  }

  function removeOffer(index: number) {
    setOffers((rows) => rows.filter((_, i) => i !== index));
  }

  async function save() {
    // Armar y validar las ofertas en el cliente para dar feedback claro.
    const parsedOffers: {
      key: string;
      label: string;
      qty: number;
      total: number;
      compare_at: number | null;
    }[] = [];
    for (const row of offers) {
      const key = row.key.trim();
      const label = row.label.trim();
      const qty = Number(row.qty);
      const total = Number(row.total);
      if (!key || !label) {
        toast.error('Cada oferta necesita clave y etiqueta.');
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error('La cantidad de cada oferta debe ser mayor a 0.');
        return;
      }
      if (!Number.isFinite(total) || total < 0) {
        toast.error('El total de cada oferta no puede ser negativo.');
        return;
      }
      let compareAt: number | null = null;
      if (row.compare_at.trim() !== '') {
        const c = Number(row.compare_at);
        if (!Number.isFinite(c)) {
          toast.error('El precio comparativo debe ser un número.');
          return;
        }
        compareAt = c;
      }
      parsedOffers.push({ key, label, qty, total, compare_at: compareAt });
    }

    const transferAmt = transferAmount.trim();
    let transferAmountValue: number | null = null;
    if (transferAmt !== '') {
      const n = Number(transferAmt);
      if (!Number.isFinite(n)) {
        toast.error('El descuento por transferencia debe ser un número.');
        return;
      }
      transferAmountValue = n;
    }

    const methods = paymentMethods
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/checkout-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          currency: currency.trim() || null,
          offers: parsedOffers,
          transfer_discount_amount: transferAmountValue,
          transfer_discount_label: transferLabel.trim() || null,
          payment_methods: methods.length ? methods : null,
          default_variant_id: defaultVariantId.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo guardar la configuración');
        return;
      }
      toast.success('Configuración de checkout guardada');
    } catch {
      toast.error('Error de red');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Checkout IA</p>
          <p className="text-xs text-muted-foreground">
            Define las ofertas, la moneda y los pagos que el asistente usa al
            armar el link de compra en Shopify.
          </p>
        </div>
        {isAdmin && (
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Activar checkout IA"
          />
        )}
      </div>

      {loading ? (
        <div className="mt-3 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <fieldset disabled={!isAdmin} className="mt-4 space-y-5">
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">
              Solo un administrador puede editar esta configuración.
            </p>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="checkout-currency">Moneda</Label>
            <Input
              id="checkout-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="ARS, USD, COP…"
              className="max-w-[160px]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Ofertas (bundles)</Label>
              {isAdmin && (
                <Button
                  type="button"
                  onClick={addOffer}
                  variant="secondary"
                  size="sm"
                >
                  <Plus className="h-4 w-4" />
                  Agregar oferta
                </Button>
              )}
            </div>

            {offers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin ofertas, el checkout usa el precio real del producto en
                Shopify (modo automático). Agrega ofertas para bundles.
              </p>
            ) : (
              <div className="space-y-2">
                {offers.map((offer, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_80px_110px_110px_auto]"
                  >
                    <Input
                      value={offer.key}
                      onChange={(e) => updateOffer(i, { key: e.target.value })}
                      placeholder="clave (ej. bundle_3)"
                    />
                    <Input
                      value={offer.label}
                      onChange={(e) => updateOffer(i, { label: e.target.value })}
                      placeholder="etiqueta (ej. 2+1 gratis)"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={offer.qty}
                      onChange={(e) => updateOffer(i, { qty: e.target.value })}
                      placeholder="qty"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={offer.total}
                      onChange={(e) => updateOffer(i, { total: e.target.value })}
                      placeholder="total"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={offer.compare_at}
                      onChange={(e) =>
                        updateOffer(i, { compare_at: e.target.value })
                      }
                      placeholder="antes (opcional)"
                    />
                    {isAdmin && (
                      <Button
                        type="button"
                        onClick={() => removeOffer(i)}
                        variant="ghost"
                        size="icon"
                        aria-label="Quitar oferta"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="checkout-transfer-amount">
                Descuento por transferencia
              </Label>
              <Input
                id="checkout-transfer-amount"
                type="number"
                inputMode="decimal"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="monto (opcional)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="checkout-transfer-label">
                Etiqueta del descuento
              </Label>
              <Input
                id="checkout-transfer-label"
                value={transferLabel}
                onChange={(e) => setTransferLabel(e.target.value)}
                placeholder="transferencia"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="checkout-payment-methods">Métodos de pago</Label>
            <Input
              id="checkout-payment-methods"
              value={paymentMethods}
              onChange={(e) => setPaymentMethods(e.target.value)}
              placeholder="card, mercado_pago"
            />
            <p className="text-[11px] text-muted-foreground">
              Separa con comas. Vacío acepta todos los métodos.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="checkout-default-variant">
              Variant por defecto (Shopify)
            </Label>
            <Input
              id="checkout-default-variant"
              value={defaultVariantId}
              onChange={(e) => setDefaultVariantId(e.target.value)}
              placeholder="ID del variant"
              className="max-w-xs"
            />
          </div>

          {isAdmin && (
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
              </Button>
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
