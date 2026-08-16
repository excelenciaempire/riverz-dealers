import { ALL_TOOLS } from '@/lib/mcp/registry';
import { getLocale } from '@/lib/i18n/server';
import { DocsNav, type NavItem } from './_components/nav';
import { instruccionesParaAgente } from './_components/instrucciones';
import { d, type DocsKey } from './_content/copy';
import {
  Eyebrow,
  H1,
  H3,
  Lead,
  Section,
  P,
  UL,
  LI,
  Pre,
  Card,
  Nota,
  Paso,
  Rich,
  ToolRow,
  ToolTable,
  A,
} from './_components/docs-ui';

/**
 * Toda la documentación en una sola página, en español y en inglés.
 *
 * Antes eran cinco rutas. La conexión se explicaba en una, las herramientas en
 * otra y la seguridad en una tercera, de modo que para conectar un cliente había
 * que ir y volver tres veces. Acá se lee de corrido y el buscador del navegador
 * encuentra cualquier nombre de herramienta de una sola pasada. Las rutas viejas
 * siguen existiendo y redirigen a su ancla, porque un enlace que alguien guardó
 * no se rompe.
 *
 * El texto vive en `_content/copy.ts` con los dos idiomas juntos; la estructura
 * es una sola, así que un cambio de forma no puede aplicarse a medias.
 *
 * La sección de herramientas se genera de `ALL_TOOLS`, que es exactamente lo que
 * el servidor expone. Una lista escrita a mano se desincroniza siempre, y una
 * referencia que miente es peor que no tenerla: manda a alguien a llamar algo
 * que ya no existe y le hace creer que el error es suyo.
 */

const APP = process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co';

const GRUPOS = [
  { risk: 'lectura', id: 'tools-lectura', label: 'groupRead', nota: 'groupReadNote' },
  { risk: 'reversible', id: 'tools-reversible', label: 'groupWrite', nota: 'groupWriteNote' },
  {
    risk: 'irreversible',
    id: 'tools-irreversible',
    label: 'groupConfirm',
    nota: 'groupConfirmNote',
  },
] as const;

export default async function DocsPage() {
  const locale = await getLocale();
  const t = (k: DocsKey, vars?: Record<string, string | number>) => d(locale, k, vars);
  const LLAVE = t('keyPlaceholder');

  // Las herramientas del equipo no se documentan: una llave de comercio no las
  // puede llamar, y listarlas sólo produce intentos que terminan en un rechazo.
  const tools = ALL_TOOLS.filter((x) => !x.platformOnly);
  const desc = (x: (typeof tools)[number]) =>
    locale === 'en' ? (x.descriptionEn ?? x.description) : x.description;

  const nav: NavItem[] = [
    { id: 'conexion', label: t('connTitle') },
    { id: 'herramientas', label: t('toolsTitle') },
    ...GRUPOS.map((g) => ({ id: g.id, label: t(g.label), sub: true })),
    { id: 'oauth', label: t('oauthTitle') },
    { id: 'seguridad', label: t('secTitle') },
    { id: 'errores', label: t('errTitle') },
  ];

  return (
    <>
      <nav className="hidden w-[210px] shrink-0 pt-10 lg:block">
        <DocsNav
          items={nav}
          textoCompleto={instruccionesParaAgente(locale)}
          copiar={t('copyAll')}
          copiado={t('copied')}
          titulo={t('navTitle')}
        />
      </nav>

      <article className="min-w-0 max-w-[52rem] flex-1 pt-10">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <H1>{t('title')}</H1>
        <Lead>{t('lead')}</Lead>

        {/* ── Conexión ─────────────────────────────────────────────── */}
        <Section id="conexion" title={t('connTitle')}>
          <P>{t('connIntro')}</P>

          <Nota>
            <Rich>{t('connWarn')}</Rich>
          </Nota>

          <Paso n={1} eyebrow={t('step1Eyebrow')} title={t('step1Title')}>
            {(['step1a', 'step1b', 'step1c'] as const).map((k) => (
              <P key={k}>
                <Rich>{t(k)}</Rich>
              </P>
            ))}
            <p className="mt-4">
              <A href={`${APP}/ajustes?tab=mcp`}>{t('step1Link')}</A>
            </p>
          </Paso>

          <Paso n={2} eyebrow={t('step2Eyebrow')} title={t('step2Title')}>
            <Card title={t('cardDesktop')}>
              <P>{t('cardDesktopP')}</P>
              <Pre>{`{
  "mcpServers": {
    "riverz": {
      "type": "http",
      "url": "https://riverz.co/api/mcp",
      "headers": { "Authorization": "Bearer ${LLAVE}" }
    }
  }
}`}</Pre>
            </Card>

            <Card title={t('cardTerminal')}>
              <P>{t('cardTerminalP')}</P>
              <Pre>{`claude mcp add --transport http riverz https://riverz.co/api/mcp \\
  --header "Authorization: Bearer ${LLAVE}"`}</Pre>
              <P>{t('cardTerminalNote')}</P>
            </Card>

            <Card title={t('cardOther')}>
              <P>{t('cardOtherP')}</P>
              <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer ${LLAVE}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</Pre>
              <P>
                <Rich>{t('cardOtherP2')}</Rich>
              </P>
              <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer ${LLAVE}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": { "name": "conversaciones_pendientes", "arguments": {} }
  }'`}</Pre>
            </Card>

            <Card title={t('cardOauth')}>
              <P>{t('cardOauthP')}</P>
              <Pre>https://riverz.co/api/mcp</Pre>
              <P>
                <Rich>{t('cardOauthP2')}</Rich>
              </P>
            </Card>
          </Paso>
        </Section>

        {/* ── Herramientas ─────────────────────────────────────────── */}
        <Section id="herramientas" title={t('toolsTitle')}>
          <P>{t('toolsIntro', { n: tools.length })}</P>
          <P>
            <Rich>{t('toolsWorkspace')}</Rich>
          </P>

          {GRUPOS.map((g) => {
            const lista = tools.filter((x) => x.risk === g.risk);
            if (lista.length === 0) return null;
            return (
              <div key={g.id} id={g.id} className="scroll-mt-24 pt-10">
                <H3>{t(g.label)}</H3>
                <P>{t(g.nota)}</P>
                <ToolTable>
                  {lista.map((x) => {
                    const props = Object.keys(x.schema.properties ?? {}).filter(
                      (k) => k !== 'workspace_id',
                    );
                    const req = (x.schema.required ?? []).filter((k) => k !== 'workspace_id');
                    return (
                      <ToolRow
                        key={x.name}
                        name={x.name}
                        description={desc(x)}
                        params={
                          props.length
                            ? props
                                .map((p) => (req.includes(p) ? `${p} (${t('required')})` : p))
                                .join(', ')
                            : undefined
                        }
                      />
                    );
                  })}
                </ToolTable>
              </div>
            );
          })}
        </Section>

        {/* ── OAuth ────────────────────────────────────────────────── */}
        <Section id="oauth" title={t('oauthTitle')}>
          <P>
            <Rich>{t('oauthIntro')}</Rich>
          </P>

          <H3>{t('oauthFlow')}</H3>
          <UL>
            {(['oauthFlow1', 'oauthFlow2', 'oauthFlow3', 'oauthFlow4'] as const).map((k) => (
              <LI key={k}>
                <Rich>{t(k)}</Rich>
              </LI>
            ))}
          </UL>

          <H3>{t('oauthDiscovery')}</H3>
          <Pre>{`GET https://riverz.co/.well-known/oauth-protected-resource
GET https://riverz.co/.well-known/oauth-authorization-server`}</Pre>
          <P>{t('oauthDiscoveryP')}</P>

          <H3>{t('oauthPkce')}</H3>
          <P>
            <Rich>{t('oauthPkceP')}</Rich>
          </P>

          <H3>{t('oauthRedirect')}</H3>
          <P>
            <Rich>{t('oauthRedirectP')}</Rich>
          </P>

          <H3>{t('oauthScopes')}</H3>
          <UL>
            <LI>
              <Rich>{t('oauthScopeRead')}</Rich>
            </LI>
            <LI>
              <Rich>{t('oauthScopeWrite')}</Rich>
            </LI>
          </UL>
          <P>{t('oauthScopeDefault')}</P>

          <H3>{t('oauthTtl')}</H3>
          <P>
            <Rich>{t('oauthTtlP')}</Rich>
          </P>
          <Pre>{`POST https://riverz.co/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=...&client_id=...`}</Pre>
          <P>{t('oauthRevoke')}</P>
        </Section>

        {/* ── Seguridad ────────────────────────────────────────────── */}
        <Section id="seguridad" title={t('secTitle')}>
          <H3>{t('secTenant')}</H3>
          <P>
            <Rich>{t('secTenantP')}</Rich>
          </P>

          <H3>{t('secHash')}</H3>
          <P>{t('secHashP')}</P>

          <H3>{t('secRead')}</H3>
          <P>{t('secReadP')}</P>

          <H3>{t('secConfirm')}</H3>
          <P>
            <Rich>{t('secConfirmP')}</Rich>
          </P>
          <P>{t('secConfirmP2')}</P>

          <H3>{t('secAudit')}</H3>
          <P>{t('secAuditP')}</P>
          <P>{t('secAuditP2')}</P>

          <H3>{t('secLimits')}</H3>
          <UL>
            <LI>{t('secLimit1')}</LI>
            <LI>{t('secLimit2')}</LI>
            <LI>{t('secLimit3')}</LI>
          </UL>
        </Section>

        {/* ── Errores ──────────────────────────────────────────────── */}
        <Section id="errores" title={t('errTitle')}>
          <ToolTable>
            <ToolRow name="-32001" description={t('err32001')} />
            <ToolRow name="-32003" description={t('err32003')} />
            <ToolRow name="-32005" description={t('err32005')} />
            <ToolRow name="-32601" description={t('err32601')} />
          </ToolTable>
        </Section>
      </article>
    </>
  );
}
