'use client';

import { useT } from '@/hooks/use-locale';
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

const SUFIJO: Record<string, string> = {
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
  ver_contacto: 'VerContacto',
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
}: {
  /** El agente que se está editando, para poder heredar de los permisos viejos. */
  agent: { permissions?: unknown; puede_crear_pedidos?: boolean | null };
  tools: AgentTools | null;
  onChange: (next: AgentTools) => void;
  disponible: Disponibilidad;
}) {
  const t = useT();

  const set = (key: string, mode: ToolMode) => onChange({ ...(tools ?? {}), [key]: mode });

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
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Fila({
  spec,
  modo,
  onSet,
  disponible,
}: {
  spec: ToolSpec;
  modo: ToolMode;
  onSet: (m: ToolMode) => void;
  disponible: Disponibilidad;
}) {
  const t = useT();
  const sufijo = SUFIJO[spec.key] ?? spec.key;
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
      {(falta || (modo === 'aprobacion' && !spec.proponeSolo) || !spec.modes.includes('auto')) && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {falta
            ? t(`operation.${falta}`)
            : !spec.modes.includes('auto')
              ? t('operation.toolNoAutoHint')
              : t('operation.toolModeAprobacionHint')}
        </p>
      )}
    </div>
  );
}
