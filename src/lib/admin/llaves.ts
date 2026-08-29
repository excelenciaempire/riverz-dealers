import { safeSelect, workspaceNames } from './queries';
import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * Las llaves vivas que pueden operar una cuenta desde afuera.
 *
 * El panel mostraba lo que el agente HIZO (`platform_audit_log`, en la pestaña
 * Agente) y no qué está habilitado a hacerlo. Son preguntas distintas: una
 * llave que nadie usó no deja ni una fila de auditoría, y es exactamente la que
 * hay que encontrar — la de la laptop que se perdió, la del conector que se
 * probó una vez y quedó.
 *
 * Dos orígenes, una sola tabla en pantalla:
 *
 *  - **MCP** (`mcp_tokens`): las que el comercio emite desde Ajustes → MCP.
 *  - **OAuth** (`oauth_refresh_tokens`): las que quedan cuando alguien conecta
 *    Riverz como conector desde otra app. El nombre sale de `oauth_clients`.
 *
 * Nunca sale el hash: sólo el prefijo, que es lo que alcanza para reconocer una
 * llave sin poder usarla.
 */

export type TipoLlave = 'mcp' | 'oauth';

export interface Llave {
  id: string;
  tipo: TipoLlave;
  /** Cómo la llamó quien la creó, o el nombre del conector. */
  nombre: string;
  /** Los primeros caracteres, para reconocerla. Sólo MCP los tiene. */
  prefijo: string | null;
  workspace_id: string;
  workspace_name: string | null;
  /** Qué puede hacer. Sólo OAuth lo declara. */
  alcance: string | null;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface FilaMcp {
  id: string;
  workspace_id: string;
  name: string;
  prefix: string;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface FilaOauth {
  client_id: string;
  workspace_id: string;
  scope: string;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function listLlaves(limit = 200): Promise<Llave[]> {
  const db = supabaseAdmin();

  const [mcp, oauth, clientes] = await Promise.all([
    safeSelect(
      db,
      'mcp_tokens',
      'id, workspace_id, name, prefix, created_at, last_used_at, revoked_at',
    )
      .order('created_at', { ascending: false })
      .limit(limit),
    safeSelect(
      db,
      'oauth_refresh_tokens',
      'client_id, workspace_id, scope, created_at, last_used_at, revoked_at',
    )
      .order('created_at', { ascending: false })
      .limit(limit),
    safeSelect(db, 'oauth_clients', 'client_id, name').limit(500),
  ]);

  const nombreCliente = new Map(
    ((clientes.data ?? []) as unknown as { client_id: string; name: string }[]).map((c) => [
      c.client_id,
      c.name,
    ]),
  );

  const filas: Omit<Llave, 'workspace_name'>[] = [
    ...((mcp.data ?? []) as unknown as FilaMcp[]).map((r) => ({
      id: r.id,
      tipo: 'mcp' as const,
      nombre: r.name,
      prefijo: r.prefix,
      workspace_id: r.workspace_id,
      alcance: null,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      revoked_at: r.revoked_at,
    })),
    ...((oauth.data ?? []) as unknown as FilaOauth[]).map((r) => ({
      // El hash es la clave primaria de esa tabla y no se pide: se
      // usa un id derivado del cliente y del comercio, que alcanza para React.
      id: `oauth-${r.client_id}-${r.workspace_id}-${r.created_at ?? ''}`,
      tipo: 'oauth' as const,
      nombre: nombreCliente.get(r.client_id) ?? r.client_id,
      prefijo: null,
      workspace_id: r.workspace_id,
      alcance: r.scope,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      revoked_at: r.revoked_at,
    })),
  ].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  const nombres = await workspaceNames(filas.map((f) => f.workspace_id));
  return filas.map((f) => ({
    ...f,
    workspace_name: nombres.get(f.workspace_id) ?? null,
  }));
}
