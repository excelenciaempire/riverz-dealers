'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { Switch } from '@/components/ui/switch';
import {
  AGENT_TOOLBOX,
  TOOL_GROUPS,
  toolMode,
  type AgentTools,
  type ToolGroup,
  type ToolMode,
  type ToolRequirement,
  type ToolSpec,
} from '@/lib/ai/toolbox';
import {
  REGLAS_POR_DEFECTO,
  toleranciaDesdeTexto,
  type ReglasDeCobro,
} from '@/lib/payments/reglas-de-cobro';

/**
 * Qué hace el agente, y cuándo entra una persona.
 *
 * Antes esto eran seis interruptores sueltos que no cubrían la mitad de lo que
 * el agente ya sabía hacer: cancelar, reembolsar, cobrar, descontar y buscar en
 * el catálogo no aparecían en ninguna pantalla. El comercio no podía mirar un
 * lugar y saber qué hace su agente solo.
 *
 * **El tercer estado es el que importa.** Prendido o apagado deja afuera el
 * caso que un negocio real quiere casi siempre: que lo prepare y lo confirme
 * alguien. Ese botón del medio es, literalmente, dónde se decide que entra un
 * humano — y por eso el aviso llega por WhatsApp y no a una bandeja que nadie
 * mira.
 *
 * Las que no se pueden deshacer no ofrecen "lo hace solo". No es una limitación
 * de la pantalla sino de lo que es prudente: el agente lee mensajes de
 * desconocidos, y un mensaje bien armado no puede terminar en plata que sale
 * sola. Quien no quiera la confirmación las apaga.
 */

/**
 * De la clave de la herramienta al sufijo de su clave de traducción.
 *
 * Se exporta sólo para que un test lo cruce contra `AGENT_TOOLBOX` y contra los
 * dos idiomas: una herramienta nueva sin entrada acá no rompía nada, imprimía
 * `operation.toolloquesea` en la pantalla del comercio y ahí se quedaba.
 */
export const SUFIJO: Record<string, string> = {
  buscar_producto: 'BuscarProducto',
  ver_producto: 'VerProducto',
  crear_checkout: 'CrearCheckout',
  crear_link_de_pago: 'CrearLinkDePago',
  ofrecer_descuento: 'OfrecerDescuento',
  crear_pedido: 'CrearPedido',
  lookup_order: 'LookupOrder',
  registrar_pago: 'RegistrarPago',
  editar_pedido: 'EditarPedido',
  cancelar_pedido: 'CancelarPedido',
  reembolsar: 'Reembolsar',
  abrir_devolucion: 'AbrirDevolucion',
  escalar_llamada: 'EscalarLlamada',
  enviar_proactivo: 'EnviarProactivo',
  buscar_en_internet: 'BuscarEnInternet',
  no_se_la_respuesta: 'NoSeLaRespuesta',
  ver_contacto: 'VerContacto',
  gestionar_recompra: 'GestionarRecompra',
  etiquetar_contacto: 'EtiquetarContacto',
  cerrar_conversacion: 'CerrarConversacion',
};

const GRUPO: Record<ToolGroup, string> = {
  catalogo: 'Catalogo',
  venta: 'Venta',
  pedidos: 'Pedidos',
  postventa: 'Postventa',
  conversacion: 'Conversacion',
};

const FALTA: Record<Exclude<ToolRequirement, null>, string> = {
  tienda: 'toolNeedsTienda',
  shopify: 'toolNeedsShopify',
  cobro: 'toolNeedsCobro',
  descuento: 'toolNeedsDescuento',
  voz: 'toolNeedsVoz',
};

export interface Disponibilidad {
  tienda: boolean;
  shopify: boolean;
  cobro: boolean;
  descuento: boolean;
  voz: boolean;
}

export function ToolSwitchboard({
  agent,
  tools,
  onChange,
  disponible,
  tope,
  onTope,
  reglas,
  onReglas,
}: {
  /** El agente que se está editando, para poder heredar de los permisos viejos. */
  agent: { permissions?: unknown; puede_crear_pedidos?: boolean | null };
  tools: AgentTools | null;
  onChange: (next: AgentTools) => void;
  disponible: Disponibilidad;
  /** Cuánto puede descontar, en porcentaje. Es de la cuenta, no del agente. */
  tope?: number;
  onTope?: (n: number) => void;
  /** Con qué pruebas da un pedido por cobrado. También de la cuenta. */
  reglas?: ReglasDeCobro | null;
  onReglas?: (r: ReglasDeCobro) => void;
}) {
  const t = useT();

  const set = (key: string, mode: ToolMode) => onChange({ ...(tools ?? {}), [key]: mode });

  // Qué significa "Aprobación" se decía en cada fila que estuviera en ese modo:
  // la misma oración hasta diez veces en una pantalla. Va una sola vez, al pie,
  // y sólo cuando hay al menos una herramienta que de verdad va a avisar.
  const hayAprobacion = AGENT_TOOLBOX.some(
    (spec) =>
      !spec.proponeSolo && toolMode({ ...agent, tools }, spec.key) === 'aprobacion',
  );

  return (
    <div className="space-y-5">
      {TOOL_GROUPS.map((g) => {
        const del = AGENT_TOOLBOX.filter((x) => x.group === g);
        if (del.length === 0) return null;
        return (
          <div key={g} className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(`operation.toolGroup${GRUPO[g]}`)}
            </p>
            <div className="space-y-1">
              {del.map((spec) => (
                <Fila
                  key={spec.key}
                  spec={spec}
                  modo={toolMode({ ...agent, tools }, spec.key)}
                  onSet={(m) => set(spec.key, m)}
                  disponible={disponible}
                  tope={tope}
                  onTope={onTope}
                  reglas={reglas}
                  onReglas={onReglas}
                />
              ))}
            </div>
          </div>
        );
      })}
      {hayAprobacion && (
        <p className="text-[11px] text-muted-foreground">
          {t('operation.toolModeAprobacionHint')}
        </p>
      )}
    </div>
  );
}

function Fila({
  spec,
  modo,
  onSet,
  disponible,
  tope,
  onTope,
  reglas,
  onReglas,
}: {
  spec: ToolSpec;
  modo: ToolMode;
  onSet: (m: ToolMode) => void;
  disponible: Disponibilidad;
  tope?: number;
  onTope?: (n: number) => void;
  reglas?: ReglasDeCobro | null;
  onReglas?: (r: ReglasDeCobro) => void;
}) {
  const t = useT();
  const sufijo = SUFIJO[spec.key] ?? spec.key;
  // Dar por pagado es la única que decide sobre plata que ya entró, y con qué
  // pruebas lo decide cambia por negocio: donde se venden cuatro precios
  // repetidos, acertar el monto no prueba nada; donde cada presupuesto es
  // único, sí. Sólo se muestran en "solo", que es cuando gobiernan algo: en
  // "preguntar" decide una persona y las condiciones no se usan.
  const conReglas =
    spec.key === 'registrar_pago' && typeof onReglas === 'function' && modo === 'auto';
  const r = reglas ?? REGLAS_POR_DEFECTO;
  const [tolTexto, setTolTexto] = useState(String(r.toleranciaPct));
  useEffect(() => setTolTexto(String(r.toleranciaPct)), [r.toleranciaPct]);
  // El descuento es la única que necesita un número además del modo, y ese
  // número no vivía en ninguna pantalla: se leía en tres lugares y no se podía
  // escribir en ninguno, así que la herramienta no se podía encender nunca.
  const conTope = spec.key === 'ofrecer_descuento' && typeof onTope === 'function';
  // Falta algo en la cuenta: la fila se puede tocar igual, porque apagarla o
  // dejarla lista de antemano es legítimo. Lo que cambia es que se dice por qué
  // hoy no va a pasar nada — un interruptor prendido que no hace nada y no
  // explica por qué es peor que uno apagado.
  const falta = spec.requires && !disponible[spec.requires] ? FALTA[spec.requires] : null;

  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-foreground">{t(`operation.tool${sufijo}`)}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {t(`operation.tool${sufijo}Hint`)}
          </p>
        </div>
        <div className="flex shrink-0 rounded-md bg-muted p-0.5">
          {spec.modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSet(m)}
              aria-pressed={modo === m}
              className={
                'rounded px-2 py-1 text-[11px] font-medium transition ' +
                (modo === m
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {t(`operation.toolMode${m === 'off' ? 'Off' : m === 'auto' ? 'Auto' : 'Aprobacion'}`)}
            </button>
          ))}
        </div>
      </div>
      {conTope && modo !== 'off' && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {t('operation.toolTopeDescuento')}
          <input
            type="number"
            min={0}
            max={50}
            value={tope ?? 0}
            onChange={(e) => onTope!(Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))))}
            className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-[11px] text-foreground"
          />
          %
        </label>
      )}
      {conReglas && (
        <div className="mt-2.5 space-y-2 border-t border-border/60 pt-2.5">
          {(
            [
              ['exigeComprobante', 'pagoExigeComprobante'],
              ['unSoloPendiente', 'pagoUnSoloPendiente'],
              ['exigeReferencia', 'pagoExigeReferencia'],
            ] as const
          ).map(([campo, clave]) => (
            <label
              key={campo}
              className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground"
            >
              {t(`operation.${clave}`)}
              <Switch
                checked={r[campo]}
                onCheckedChange={(v: boolean) => onReglas!({ ...r, [campo]: v })}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            {t('operation.pagoTolerancia')}
            <span className="flex items-center gap-1">
              {/* Sin estado propio no se puede escribir "0,5": cada tecla pasa
                  por `Number`, el punto recién tipeado no sobrevive y queda 5
                  —diez veces la tolerancia que se quiso poner—. Se guarda el
                  texto tal cual y se convierte al salir del campo. */}
              <input
                type="text"
                inputMode="decimal"
                value={tolTexto}
                onChange={(e) => setTolTexto(e.target.value)}
                onBlur={() => {
                  const n = toleranciaDesdeTexto(tolTexto);
                  setTolTexto(String(n));
                  if (n !== r.toleranciaPct) onReglas!({ ...r, toleranciaPct: n });
                }}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-[11px] text-foreground"
              />
              %
            </span>
          </label>
          {/* Lo que pasa a valer sin esas pruebas. No es una advertencia moral:
              es la consecuencia exacta, y el comercio decide. */}
          {(!r.exigeComprobante || !r.unSoloPendiente || !r.exigeReferencia) && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('operation.pagoReglasFlojas')}
            </p>
          )}
        </div>
      )}
      {/* Con tope 0 la herramienta ni se le ofrece al agente, así que decirlo
          acá —donde está el número— es lo único que cierra el círculo. */}
      {((falta && !conTope) || !spec.modes.includes('auto')) && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {falta && !conTope
            ? t(`operation.${falta}`)
            : t('operation.toolNoAutoHint')}
        </p>
      )}
    </div>
  );
}
