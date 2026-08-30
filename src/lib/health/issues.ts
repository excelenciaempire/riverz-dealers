/**
 * Lo que se rompió sin que nadie se entere.
 *
 * El peor modo de falla de Riverz no es un error en pantalla: es el mensaje
 * que nunca salió. Pasó el 2026-08-14 con dos carritos abandonados — la espera
 * no se pudo encolar, las corridas quedaron dormidas en "parcial" y los dos
 * clientes nunca recibieron nada. Se descubrió porque alguien abrió la pantalla
 * de la automatización y le pareció rara. Eso no es un sistema de avisos.
 *
 * Acá se junta, en un solo lugar y sobre las tablas que ya existen, todo lo que
 * significa "esto necesita tu atención". Sin tabla nueva a propósito: un
 * inventario de problemas que hay que mantener al día se desincroniza; esto se
 * calcula cada vez que se pregunta, así que no puede mentir.
 *
 * Regla de qué entra: sólo lo accionable por el comercio y lo que ya pasó. Un
 * aviso que no se puede atender es ruido, y a la tercera vez que aparece deja
 * de leerse — con él, todos los demás.
 *
 * La detección vive en SQL (`admin_workspace_issues`, migración 152) y no acá.
 * El motivo es el alcance: eran seis consultas por cuenta, así que el panel de
 * plataforma no podía correrlas para todos los comercios y terminaba diciendo
 * "todo en orden" el mismo día en que un comercio recibía el correo con seis
 * problemas. Ahora la misma función contesta por una cuenta o por todas, y las
 * dos pantallas no se pueden contradecir.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { metaCodeIn } from './detail';

export type IssueSeverity = 'critical' | 'warning';

export type IssueKind =
  | 'automation_stuck'
  | 'automation_failed'
  | 'sends_failing'
  /**
   * El WhatsApp que el agente prometió EN UNA LLAMADA y no llegó.
   *
   * Aparte de `sends_failing` porque basta UNO: en una llamada el agente dice
   * «te lo mando por WhatsApp» y el cliente cuelga contando con eso. Y es el
   * más difícil de descubrir solo — el POST a Meta devuelve 200 y el error
   * llega por webhook con la llamada ya terminada.
   */
  | 'voice_send_failed'
  | 'whatsapp_blocked'
  | 'connection_error'
  | 'template_rejected'
  | 'broadcast_stalled'
  /**
   * Un canal conectado que DEJO de recibir.
   *
   * El unico aviso que nace de una ausencia, y por eso el mas dificil de ver
   * sin el: «no llegan los mensajes» se ve exactamente igual que «no escribio
   * nadie». La suscripcion de Meta apuntaba a un host muerto desde hacia un
   * mes y nadie lo noto. No mira la causa —callback caido, suscripcion
   * perdida, token revocado—: mira el silencio, que es comun a todas.
   */
  | 'channel_silent'
  /**
   * La IA se apagó sola.
   *
   * Cinco motivos de ai_replies dicen que el turno no salió por culpa
   * NUESTRA o del proveedor: sin saldo en Anthropic, el proveedor frenando, el
   * proveedor fallando, un error del modelo, o el turno roto antes de
   * contestar. En los cinco el cliente recibe «en un momento te responde una
   * persona» y la IA deja de contestar — y eso no llegaba a ningún lado. El
   * comercio se enteraba mirando las etiquetas de la bandeja una por una.
   */
  | 'ai_down';

/**
 * Quién puede arreglarlo.
 *
 * El comercio sólo ve lo que depende de él. Un aviso que no puede atender no
 * es información: es una alarma que suena sola, y a la tercera vez deja de
 * leerse — con ella, todas las demás. Lo que es nuestro (una cola trabada, una
 * campaña que no terminó, un canal que dio timeout) sigue calculándose igual y
 * se ve entero en /admin, que es donde está quien lo puede arreglar.
 */
export type IssueAudience = 'comercio' | 'plataforma';

export interface Issue {
  /** Clave estable; la UI la traduce y decide el link. */
  kind: IssueKind;
  severity: IssueSeverity;
  /** Cuántas cosas caen bajo este aviso (mensajes, corridas, conexiones). */
  count: number;
  /** Detalle corto y concreto: un nombre, un motivo, un canal. */
  detail?: string | null;
  /** A dónde va el comercio a resolverlo (ruta canónica, en español). */
  href: string;
  audience: IssueAudience;
  /** Cuándo pasó por última vez (ISO). Decide si un aviso ocultado vuelve. */
  lastAt: string | null;
  /** A qué apunta, para poder ocultar ESTE aviso y no la clase entera. */
  refId: string;
}

/** Fila cruda de la función SQL. */
export interface IssueRow {
  workspace_id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  count: number;
  detail: string | null;
  /** La cosa a la que apunta: automatización, conversación, plantilla, canal. */
  ref_id: string | null;
  /** La fila exacta adentro: la corrida que falló. */
  ref_child: string | null;
  last_at: string | null;
}

/**
 * A dónde se resuelve cada clase de problema.
 *
 * Al LUGAR EXACTO, no a la sección. Quien abre el aviso ya sabe que algo se
 * rompió; lo que no sabe es cuál, y hacérselo buscar en una lista de cien
 * filas es la diferencia entre arreglarlo y cerrar la pestaña.
 */
function hrefFor(
  row: Pick<IssueRow, 'kind' | 'ref_id' | 'ref_child' | 'last_at' | 'detail'>,
): string {
  switch (row.kind) {
    // A la corrida que falló, ya abierta, dentro del historial de esa
    // automatización: ahí está el paso exacto y el error de Meta.
    case 'automation_stuck':
    case 'automation_failed': {
      if (!row.ref_id) return '/automatizaciones';
      const base = `/automatizaciones/${row.ref_id}/registros`;
      return row.ref_child ? `${base}?log=${row.ref_child}` : base;
    }
    // Al hilo del cliente y al mensaje: ahí se ve en rojo con el motivo, y
    // desde ahí se le escribe a mano lo que se le prometió y no llegó.
    case 'sends_failing':
    case 'voice_send_failed': {
      if (!row.ref_id) return '/bandeja';
      const iso = aISO(row.last_at);
      return `/bandeja?c=${row.ref_id}${iso ? `&t=${encodeURIComponent(iso)}` : ''}`;
    }
    // A la tarjeta del canal caído, no al principio de la página.
    case 'connection_error':
    case 'whatsapp_blocked': {
      const ancla = anchorDeCanal(row.ref_id);
      return ancla ? `/integraciones#${ancla}` : '/integraciones';
    }
    case 'template_rejected':
      return row.ref_id ? `/plantillas/${row.ref_id}` : '/plantillas';
    case 'broadcast_stalled':
      return row.ref_id ? `/campanas/${row.ref_id}` : '/campanas';
    // A la tarjeta del canal callado: ahi esta el boton de reconectar, que es
    // lo que arregla casi todas las causas.
    case 'channel_silent': {
      const ancla = anchorDeCanal(row.ref_id);
      return ancla ? `/integraciones#${ancla}` : '/integraciones';
    }
    // Sin saldo se arregla recargando; el resto se mira desde los asistentes,
    // que es donde el comercio ve si están contestando.
    case 'ai_down':
      return row.detail === 'ai_no_credit' ? '/ajustes#saldo' : '/asistentes';
  }
}

/**
 * Ancla de la tarjeta del canal en /integraciones. Las tarjetas agrupan varios
 * canales internos (Messenger y sus comentarios son una sola "Meta"), así que
 * el slug de la conexión no siempre es el de la tarjeta. Una tienda caída llega
 * como dominio y no tiene tarjeta propia: ahí no hay ancla y se abre la página.
 */
const TARJETA_POR_CANAL: Record<string, string> = {
  whatsapp: 'canal-whatsapp',
  messenger: 'canal-facebook',
  fb_comment: 'canal-facebook',
  instagram: 'canal-instagram',
  ig_comment: 'canal-instagram',
  gmail: 'canal-gmail',
  outlook: 'canal-outlook',
  mercadolibre: 'canal-mercadolibre',
  tiktok_comment: 'canal-tiktok',
};

function anchorDeCanal(slug: string | null): string | null {
  if (!slug) return null;
  return TARJETA_POR_CANAL[slug.trim()] ?? null;
}

/**
 * Códigos de Meta que el comercio SÍ puede arreglar: son de la plantilla o del
 * destinatario, no del transporte. Los otros —ventana de 24 h, tope de
 * marketing, spam, timeout— no tienen botón que apretar de su lado.
 */
const CODIGOS_DE_CONFIGURACION = new Set([
  131008, // falta un parámetro obligatorio (variable vacía)
  131009, // el valor de un parámetro no es válido
  132000, // la cantidad de parámetros no coincide
  132001, // la plantilla no existe en ese idioma
  132005, // el texto traducido excede el largo
  132007, // el contenido viola el formato permitido
  132012, // el formato del parámetro no coincide
  133010, // el número no está registrado en la Cloud API
  100, // parámetro inválido
]);

/** Lo mismo cuando el motivo llega como frase y no como código. */
const MOTIVOS_DE_CONFIGURACION =
  /template not found|plantilla no encontrada|no template|template name does not exist|required parameter is missing|parameter value is not valid|number of parameters does not match|no recipients?|sin destinatarios|invalid phone number|número inválido|not connected|sin conexión|no (whatsapp )?connection/i;

function esDeConfiguracion(detail: string | null): boolean {
  const raw = detail?.trim();
  if (!raw) return false;
  const code = metaCodeIn(raw);
  if (code != null) return CODIGOS_DE_CONFIGURACION.has(code);
  return MOTIVOS_DE_CONFIGURACION.test(raw);
}

function audienceFor(row: Pick<IssueRow, 'kind' | 'detail'>): IssueAudience {
  switch (row.kind) {
    // Se arreglan en el panel de Meta, en /integraciones o en la plantilla:
    // todo del lado del comercio.
    case 'whatsapp_blocked':
    case 'connection_error':
    case 'template_rejected':
      return 'comercio';
    // Alguien quedó esperando un mensaje que le prometieron hablando. Aunque
    // la causa sea nuestra, el que puede escribirle hoy es el comercio.
    case 'voice_send_failed':
      return 'comercio';
    // Depende del motivo: una variable vacía la llena el comercio; un timeout
    // del canal no lo arregla nadie desde la pantalla.
    case 'automation_failed':
    case 'sends_failing':
      return esDeConfiguracion(row.detail) ? 'comercio' : 'plataforma';
    // Cola trabada y campaña a medio enviar: no hay nada que tocar del lado
    // del comercio, se destraban de este lado.
    case 'automation_stuck':
    case 'broadcast_stalled':
      return 'plataforma';
    // La causa suele ser nuestra o de Meta, pero el boton que la arregla
    // —reconectar el canal— esta del lado del comercio, y mientras tanto es el
    // unico que puede salir a contestar a mano lo que no esta llegando.
    case 'channel_silent':
      return 'comercio';
    // Sin saldo lo resuelve el comercio, y es lo único que puede resolver.
    // Que el proveedor frene o falle es nuestro: avisarle no le da nada que
    // hacer, y una alarma que no se puede atender deja de leerse.
    case 'ai_down':
      return row.detail === 'ai_no_credit' ? 'comercio' : 'plataforma';
  }
}

/**
 * `last_at` en ISO, siempre. PostgREST ya lo devuelve así, pero la misma
 * función se consulta por otras vías que escriben «2026-08-28 06:06:23+00», y
 * ese formato no lo parsea todo motor de JS. Si no se puede leer, se devuelve
 * null: sin fecha el aviso se muestra igual, que es el lado seguro del error.
 */
function aISO(raw: string | null): string | null {
  if (!raw) return null;
  const conT = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const conZona = /[+-]\d{2}$/.test(conT) ? `${conT}:00` : conT;
  const d = new Date(conZona);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lo crítico primero: son las que cortan envíos. */
function porGravedad(a: Issue, b: Issue): number {
  if (a.severity === b.severity) return b.count - a.count;
  return a.severity === 'critical' ? -1 : 1;
}

export function toIssue(row: IssueRow): Issue {
  return {
    kind: row.kind,
    severity: row.severity,
    count: Number(row.count) || 0,
    detail: row.detail,
    href: hrefFor(row),
    audience: audienceFor(row),
    lastAt: aISO(row.last_at),
    refId: row.ref_id ?? '',
  };
}

/** Lo que necesita atención en UN comercio. */
export async function collectWorkspaceIssues(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue[]> {
  const { data, error } = await db.rpc('admin_workspace_issues', {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`[health] admin_workspace_issues: ${error.message}`);
  const issues = ((data ?? []) as IssueRow[]).map(toIssue);

  return issues.sort(porGravedad);
}

/** Clave de un aviso a los efectos de ocultarlo. */
export function issueKey(i: Pick<Issue, 'kind' | 'refId'>): string {
  return `${i.kind}::${i.refId}`;
}

/**
 * Lo que el comercio tiene que ver HOY en Inicio.
 *
 * Dos filtros sobre la lista completa: lo que puede arreglar él, y lo que no
 * ocultó. Ocultar no es "para siempre" ni "hasta que recargue": vale hasta el
 * instante que se ocultó, así que si el problema vuelve a pasar más tarde el
 * aviso reaparece solo. Es la única regla que no entrena a ignorarlo.
 */
export async function collectMerchantIssues(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue[]> {
  const [issues, ocultos] = await Promise.all([
    collectWorkspaceIssues(db, workspaceId),
    db
      .from('health_issue_dismissals')
      .select('kind, ref_id, hidden_through')
      .eq('workspace_id', workspaceId),
  ]);

  const hasta = new Map<string, number>();
  for (const row of (ocultos.data ?? []) as {
    kind: string;
    ref_id: string;
    hidden_through: string;
  }[]) {
    hasta.set(`${row.kind}::${row.ref_id}`, new Date(row.hidden_through).getTime());
  }

  return issues.filter((i) => {
    if (i.audience !== 'comercio') return false;
    const limite = hasta.get(issueKey(i));
    if (limite == null) return true;
    // Sin fecha no se puede decidir si es nuevo; se muestra, que es el lado
    // seguro del error.
    if (!i.lastAt) return true;
    return new Date(i.lastAt).getTime() > limite;
  });
}

/**
 * Lo mismo para TODA la plataforma, agrupado por comercio. Es lo que mira el
 * panel: una sola consulta en vez de seis por cuenta.
 */
export async function collectPlatformIssues(
  db: SupabaseClient,
): Promise<Map<string, Issue[]>> {
  const { data, error } = await db.rpc('admin_workspace_issues', {
    p_workspace_id: null,
  });
  if (error) throw new Error(`[health] admin_workspace_issues: ${error.message}`);

  const out = new Map<string, Issue[]>();
  for (const row of (data ?? []) as IssueRow[]) {
    const list = out.get(row.workspace_id) ?? [];
    list.push(toIssue(row));
    out.set(row.workspace_id, list);
  }
  for (const list of out.values()) list.sort(porGravedad);
  return out;
}
