/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal mock of the Supabase JS client used in demo mode. Implements
 * just enough of the `.from(...).select()/.insert()/.update()/.delete()`
 * surface to keep the unified-inbox UI happy without a real backend.
 *
 * Data lives in process memory (the module scope below) — survives
 * hot reload but resets on full server restart, which is what we want
 * for a demo. All inserts/updates mutate the same arrays so the UI
 * sees its own writes reflected back via the realtime channel
 * (`mockRealtime`).
 */

import {
  DEMO_CONNECTIONS,
  DEMO_CONTACTS,
  DEMO_CONVERSATIONS,
  DEMO_MEMBERSHIP,
  DEMO_MESSAGES,
  DEMO_PROFILE,
  DEMO_TAGS,
  DEMO_TEMPLATES,
  DEMO_USER_ID,
  DEMO_WORKSPACE,
} from "./seed";

type Row = Record<string, any>;

interface Filter {
  kind: "eq" | "neq" | "in" | "is" | "gte" | "lt" | "lte" | "gt" | "like";
  column: string;
  value: any;
}

interface BuilderState {
  table: string;
  filters: Filter[];
  selectExpr?: string;
  orderBy?: { column: string; ascending: boolean };
  limit?: number;
  range?: { from: number; to: number };
  single?: boolean;
  maybeSingle?: boolean;
  head?: boolean;
  count?: "exact" | "planned" | "estimated" | null;
}

// In-memory tables. Each is a plain array that the builder mutates.
const TABLES: Record<string, Row[]> = {
  profiles: [{ ...DEMO_PROFILE }],
  workspaces: [{ ...DEMO_WORKSPACE }],
  workspace_members: [
    { ...DEMO_MEMBERSHIP, user: { ...DEMO_PROFILE } } as Row,
  ],
  workspace_invites: [],
  contacts: DEMO_CONTACTS.map((c) => ({ ...c })),
  conversations: DEMO_CONVERSATIONS.map((c) => ({ ...c })),
  messages: DEMO_MESSAGES.map((m) => ({ ...m })),
  message_templates: DEMO_TEMPLATES.map((t) => ({ ...t })),
  channel_connections: DEMO_CONNECTIONS.map((c) => ({ ...c })),
  tags: DEMO_TAGS.map((t) => ({ ...t })),
  contact_tags: [],
  contact_notes: [],
  contact_custom_values: [],
  custom_fields: [],
  broadcasts: [],
  broadcast_recipients: [],
  automations: [],
  automation_steps: [],
  automation_logs: [],
  flows: [],
  flow_nodes: [],
  flow_runs: [],
  comments_meta: [],
};

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((r) => {
    for (const f of filters) {
      const v = r[f.column];
      if (f.kind === "eq" && v !== f.value) return false;
      if (f.kind === "neq" && v === f.value) return false;
      if (f.kind === "is" && v !== f.value) return false;
      if (f.kind === "in" && !(f.value as any[]).includes(v)) return false;
      if (f.kind === "gte" && !(v >= f.value)) return false;
      if (f.kind === "gt" && !(v > f.value)) return false;
      if (f.kind === "lte" && !(v <= f.value)) return false;
      if (f.kind === "lt" && !(v < f.value)) return false;
      if (f.kind === "like" && typeof v === "string" && !v.includes(String(f.value).replaceAll("%", ""))) return false;
    }
    return true;
  });
}

function applyOrder(rows: Row[], order?: BuilderState["orderBy"]): Row[] {
  if (!order) return rows;
  const { column, ascending } = order;
  return [...rows].sort((a, b) => {
    const va = a[column];
    const vb = b[column];
    if (va === vb) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va > vb ? 1 : -1) * (ascending ? 1 : -1);
  });
}

function joinSelect(rows: Row[], state: BuilderState): Row[] {
  if (!state.selectExpr || !state.selectExpr.includes("(")) return rows;
  // Cheapest possible join: detect "alias:table(*)" or "table(*)" and hydrate
  // a `table` field on each row using the foreign-key naming convention.
  // Good enough for the demo seed which only joins conversations.contact
  // and workspace_members.user.
  const joinHints: Array<{ as: string; table: string }> = [];
  for (const match of state.selectExpr.matchAll(/(?:([\w_]+):)?([\w_]+)\([^)]*\)/g)) {
    const as = match[1] ?? match[2];
    joinHints.push({ as, table: match[2] });
  }
  if (joinHints.length === 0) return rows;

  return rows.map((row) => {
    const hydrated: Row = { ...row };
    for (const { as, table } of joinHints) {
      if (table === "contacts" && row.contact_id) {
        const c = TABLES.contacts.find((x) => x.id === row.contact_id);
        if (c) hydrated[as] = c;
      } else if (table === "workspaces" && row.workspace_id) {
        const w = TABLES.workspaces.find((x) => x.id === row.workspace_id);
        if (w) hydrated[as] = w;
      } else if (table === "profiles") {
        const p = TABLES.profiles.find((x) => x.user_id === row.user_id);
        if (p) hydrated[as] = p;
      } else if (table === "tags" && row.tag_id) {
        const t = TABLES.tags.find((x) => x.id === row.tag_id);
        if (t) hydrated[as] = t;
      }
    }
    return hydrated;
  });
}

function notifyChange(table: string) {
  const listeners = realtimeListeners.get(table) ?? [];
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      // swallow demo errors
    }
  }
}

const realtimeListeners = new Map<string, Array<() => void>>();

function newId(prefix = "demo"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

class QueryBuilder {
  private state: BuilderState;
  private payload: Row | Row[] | null = null;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";

  constructor(table: string) {
    this.state = { table, filters: [] };
  }

  select(expr = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    this.state.selectExpr = expr;
    if (opts?.count) this.state.count = opts.count;
    if (opts?.head) this.state.head = opts.head;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[]) {
    this.mode = "upsert";
    this.payload = payload;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(column: string, value: any) {
    this.state.filters.push({ kind: "eq", column, value });
    return this;
  }
  neq(column: string, value: any) {
    this.state.filters.push({ kind: "neq", column, value });
    return this;
  }
  is(column: string, value: any) {
    this.state.filters.push({ kind: "is", column, value });
    return this;
  }
  in(column: string, values: any[]) {
    this.state.filters.push({ kind: "in", column, value: values });
    return this;
  }
  gte(column: string, value: any) {
    this.state.filters.push({ kind: "gte", column, value });
    return this;
  }
  gt(column: string, value: any) {
    this.state.filters.push({ kind: "gt", column, value });
    return this;
  }
  lte(column: string, value: any) {
    this.state.filters.push({ kind: "lte", column, value });
    return this;
  }
  lt(column: string, value: any) {
    this.state.filters.push({ kind: "lt", column, value });
    return this;
  }
  like(column: string, value: string) {
    this.state.filters.push({ kind: "like", column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.state.orderBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.state.limit = n;
    return this;
  }
  range(from: number, to: number) {
    this.state.range = { from, to };
    return this;
  }
  single() {
    this.state.single = true;
    return this.run();
  }
  maybeSingle() {
    this.state.maybeSingle = true;
    return this.run();
  }
  then<T = any>(onResolve?: (v: any) => T, onReject?: (e: any) => T) {
    return this.run().then(onResolve, onReject);
  }
  catch(onReject: (e: any) => any) {
    return this.run().catch(onReject);
  }
  finally(cb: () => void) {
    return this.run().finally(cb);
  }

  private async run(): Promise<{ data: any; error: any; count?: number }> {
    const table = TABLES[this.state.table];
    if (!table) {
      // Unknown table — return empty rather than blowing up demo UI.
      return { data: this.state.single ? null : [], error: null };
    }

    if (this.mode === "insert" || this.mode === "upsert") {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted: Row[] = [];
      for (const item of items) {
        const row: Row = {
          id: item.id ?? newId(this.state.table),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...item,
        };
        table.push(row);
        inserted.push(row);
      }
      notifyChange(this.state.table);
      const data = this.state.single || this.state.maybeSingle ? inserted[0] : inserted;
      return { data, error: null };
    }

    if (this.mode === "update") {
      const matching = applyFilters(table, this.state.filters);
      for (const row of matching) {
        Object.assign(row, this.payload, { updated_at: new Date().toISOString() });
      }
      notifyChange(this.state.table);
      const data = this.state.single || this.state.maybeSingle ? matching[0] ?? null : matching;
      return { data, error: null };
    }

    if (this.mode === "delete") {
      const matching = applyFilters(table, this.state.filters);
      for (const row of matching) {
        const idx = table.indexOf(row);
        if (idx >= 0) table.splice(idx, 1);
      }
      notifyChange(this.state.table);
      return { data: matching, error: null };
    }

    // select
    let rows = applyFilters(table, this.state.filters);
    rows = applyOrder(rows, this.state.orderBy);
    if (this.state.range) {
      rows = rows.slice(this.state.range.from, this.state.range.to + 1);
    } else if (this.state.limit != null) {
      rows = rows.slice(0, this.state.limit);
    }
    rows = joinSelect(rows, this.state);

    const count = this.state.count ? applyFilters(table, this.state.filters).length : undefined;

    if (this.state.head) {
      return { data: null, error: null, count };
    }
    if (this.state.single) {
      return { data: rows[0] ?? null, error: rows.length === 0 ? { code: "PGRST116" } : null, count };
    }
    if (this.state.maybeSingle) {
      return { data: rows[0] ?? null, error: null, count };
    }
    return { data: rows, error: null, count };
  }
}

class Channel {
  on(_event: string, _filter: any, _handler: any) {
    return this;
  }
  subscribe(cb?: (state: string) => void) {
    cb?.("SUBSCRIBED");
    return this;
  }
  unsubscribe() {
    return this;
  }
}

const fakeUser = {
  id: DEMO_USER_ID,
  email: DEMO_PROFILE.email,
  user_metadata: { full_name: DEMO_PROFILE.full_name },
  app_metadata: {},
  aud: "authenticated",
  created_at: DEMO_PROFILE.created_at,
};
const fakeSession = {
  access_token: "demo-token",
  refresh_token: "demo-refresh",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: fakeUser,
};

export function createMockClient() {
  return {
    from(table: string) {
      return new QueryBuilder(table);
    },
    channel(_name: string) {
      return new Channel();
    },
    removeChannel(_channel: any) {
      // noop
    },
    rpc(_fn: string, _args?: any) {
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      async getUser() {
        return { data: { user: fakeUser }, error: null };
      },
      async getSession() {
        return { data: { session: fakeSession }, error: null };
      },
      async signInWithPassword(_credentials: { email: string; password: string }) {
        return { data: { user: fakeUser, session: fakeSession }, error: null };
      },
      async signUp(_credentials: { email: string; password: string }) {
        return { data: { user: fakeUser, session: fakeSession }, error: null };
      },
      async signOut() {
        return { error: null };
      },
      async resetPasswordForEmail(_email: string) {
        return { data: {}, error: null };
      },
      async updateUser(_attrs: any) {
        return { data: { user: fakeUser }, error: null };
      },
      onAuthStateChange(cb: (event: string, session: any) => void) {
        // Fire immediately with the fake session so use-auth resolves.
        Promise.resolve().then(() => cb("SIGNED_IN", fakeSession));
        return {
          data: { subscription: { unsubscribe: () => {} } },
        };
      },
    },
    storage: {
      from(_bucket: string) {
        return {
          async upload(_path: string, _file: any) {
            return { data: { path: _path }, error: null };
          },
          getPublicUrl(_path: string) {
            return { data: { publicUrl: "/icon" } };
          },
        };
      },
    },
  };
}

export { isDemoMode } from "@/lib/demo";
