import { ALL_TOOLS } from '@/lib/mcp/registry';
import { H1, H2, Lead, P, Code, Nota } from '../../_components/prose';

export const dynamic = 'force-static';

/**
 * La referencia de herramientas, generada del propio código.
 *
 * Se recorre `ALL_TOOLS`, que es exactamente lo que el servidor expone. Una
 * lista escrita a mano se desincroniza —siempre— y una referencia que miente es
 * peor que no tenerla: manda a alguien a llamar algo que ya no existe y le hace
 * creer que el error es suyo. Acá, agregar una herramienta la documenta.
 */
const RIESGO: Record<string, { label: string; nota: string; clase: string }> = {
  lectura: {
    label: 'Lectura',
    nota: 'No cambia nada. Disponible con cualquier llave.',
    clase: 'text-emerald-600 dark:text-emerald-400',
  },
  reversible: {
    label: 'Reversible',
    nota: 'Cambia algo que se puede deshacer. Necesita una llave de escritura.',
    clase: 'text-amber-600 dark:text-amber-400',
  },
  irreversible: {
    label: 'Irreversible',
    nota: 'Le llega a una persona. Necesita llave de escritura Y confirmación.',
    clase: 'text-red-600 dark:text-red-400',
  },
};

export default function DocsHerramientas() {
  // Las del equipo no se documentan: no las puede llamar una llave de comercio,
  // y listarlas sólo genera intentos que terminan en un rechazo.
  const tools = ALL_TOOLS.filter((t) => !t.platformOnly);
  const porRiesgo = (r: string) => tools.filter((t) => t.risk === r);

  return (
    <article>
      <H1>Herramientas</H1>
      <Lead>
        Las {tools.length} herramientas que expone Riverz por MCP. Esta lista se genera del código
        que corre en producción, así que no puede quedar vieja.
      </Lead>

      <Nota>
        <Code>workspace_id</Code> aparece en muchos esquemas porque el servidor lo usa
        internamente, pero <strong>no hace falta que lo mandes</strong>: sale de tu llave. Si
        mandás uno que no es el tuyo, la llamada se rechaza.
      </Nota>

      {(['lectura', 'reversible', 'irreversible'] as const).map((r) => {
        const lista = porRiesgo(r);
        if (lista.length === 0) return null;
        const meta = RIESGO[r];
        return (
          <section key={r}>
            <H2>
              <span className={meta.clase}>{meta.label}</span>
            </H2>
            <P>{meta.nota}</P>
            <div className="mt-4 space-y-3">
              {lista.map((t) => {
                const props = Object.keys(t.schema.properties ?? {}).filter(
                  (k) => k !== 'workspace_id',
                );
                const req = (t.schema.required ?? []).filter((k) => k !== 'workspace_id');
                return (
                  <div key={t.name} className="rounded-lg border border-border bg-card p-4">
                    <code className="font-mono text-sm font-semibold text-foreground">
                      {t.name}
                    </code>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {t.description}
                    </p>
                    {props.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Parámetros: </span>
                        {props
                          .map((p) => (req.includes(p) ? `${p} (obligatorio)` : p))
                          .join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </article>
  );
}
