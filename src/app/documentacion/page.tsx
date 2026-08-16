import { ALL_TOOLS } from '@/lib/mcp/registry';
import { DocsNav, type NavItem } from './_components/nav';
import { instruccionesParaAgente } from './_components/instrucciones';
import {
  Eyebrow,
  H1,
  H3,
  Lead,
  Section,
  P,
  UL,
  LI,
  Code,
  Pre,
  Card,
  Nota,
  Paso,
  ToolRow,
  ToolTable,
  A,
} from './_components/docs-ui';

export const dynamic = 'force-static';

/**
 * Toda la documentación en una sola página.
 *
 * Antes eran cinco rutas. La conexión se explicaba en una, las herramientas en
 * otra y la seguridad en una tercera, de modo que para conectar un cliente había
 * que ir y volver tres veces. Acá se lee de corrido y el buscador del navegador
 * encuentra cualquier nombre de herramienta de una sola pasada. Las rutas viejas
 * siguen existiendo y redirigen a su ancla, porque un enlace que alguien guardó
 * no se rompe.
 *
 * La sección de herramientas se genera de `ALL_TOOLS`, que es exactamente lo que
 * el servidor expone. Una lista escrita a mano se desincroniza siempre, y una
 * referencia que miente es peor que no tenerla: manda a alguien a llamar algo
 * que ya no existe y le hace creer que el error es suyo.
 */

const APP = process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co';

const NAV: NavItem[] = [
  { id: 'conexion', label: 'Conexión' },
  { id: 'herramientas', label: 'Herramientas' },
  { id: 'tools-lectura', label: 'Consulta', sub: true },
  { id: 'tools-reversible', label: 'Acción', sub: true },
  { id: 'tools-irreversible', label: 'Con confirmación', sub: true },
  { id: 'oauth', label: 'OAuth' },
  { id: 'seguridad', label: 'Seguridad' },
  { id: 'errores', label: 'Errores frecuentes' },
];

const GRUPOS = [
  {
    risk: 'lectura' as const,
    id: 'tools-lectura',
    label: 'Consulta',
    nota: 'No modifican nada. Disponibles con cualquier llave.',
  },
  {
    risk: 'reversible' as const,
    id: 'tools-reversible',
    label: 'Acción',
    nota: 'Modifican algo que se puede deshacer. Requieren una llave de lectura y escritura.',
  },
  {
    risk: 'irreversible' as const,
    id: 'tools-irreversible',
    label: 'Con confirmación',
    nota: 'Su efecto llega a una persona. Requieren llave de escritura y además un segundo llamado con el token de confirmación.',
  },
];

export default function DocsPage() {
  // Las herramientas del equipo no se documentan: una llave de comercio no las
  // puede llamar, y listarlas sólo produce intentos que terminan en un rechazo.
  const tools = ALL_TOOLS.filter((t) => !t.platformOnly);

  return (
    <>
      <nav className="hidden w-[210px] shrink-0 pt-10 lg:block">
        <DocsNav items={NAV} textoCompleto={instruccionesParaAgente()} />
      </nav>

      <article className="min-w-0 max-w-[52rem] flex-1 pt-10">
        <Eyebrow>Documentación</Eyebrow>
        <H1>Usa Riverz desde tu asistente de IA</H1>
        <Lead>
          Riverz habla MCP. Con una llave, cualquier asistente que soporte el protocolo puede
          consultar la operación de la cuenta y actuar sobre ella: qué conversaciones quedaron sin
          responder, por qué un mensaje no llegó, cómo terminó una campaña, o escribirle a un
          cliente.
        </Lead>

        {/* ── Conexión ─────────────────────────────────────────────── */}
        <Section id="conexion" title="Conexión">
          <P>
            Son dos pasos. El primero se hace una sola vez y el segundo depende de qué cliente se
            use.
          </P>

          <Nota>
            <strong className="text-[#f7ff9e]">Importante:</strong> pegar esta página dentro de un
            chat no conecta nada. Conectar un asistente a tus datos exige una acción explícita en
            sus ajustes. Es una medida del protocolo, no un límite de Riverz.
          </Nota>

          <Paso n={1} eyebrow="Una sola vez" title="Crea tu llave en Riverz">
            <P>
              En <strong className="text-[#d8d8dd]">Ajustes, Agentes (MCP)</strong>. Conviene
              ponerle un nombre que diga dónde va a estar instalada, por ejemplo &ldquo;laptop de
              Juan&rdquo; o &ldquo;n8n&rdquo;: ese nombre es lo que permite revocar una llave
              concreta sin tocar las demás.
            </P>
            <P>
              Después se elige el alcance. <strong className="text-[#d8d8dd]">Sólo lectura</strong>{' '}
              consulta la operación sin modificar nada.{' '}
              <strong className="text-[#d8d8dd]">Lectura y escritura</strong> además permite activar
              automatizaciones y enviar mensajes.
            </P>
            <P>
              El valor se muestra <strong className="text-[#d8d8dd]">una sola vez</strong>. No es
              una limitación de la interfaz: en la base de datos se guarda un hash, de modo que
              Riverz tampoco puede volver a mostrarlo. Si se pierde, se revoca y se crea otra.
            </P>
            <p className="mt-4">
              <A href={`${APP}/ajustes?tab=mcp`}>Crear una llave en Ajustes</A>
            </p>
          </Paso>

          <Paso n={2} eyebrow="Según el cliente" title="Pega la llave en tu asistente">
            <Card title="Claude Desktop, Cursor y compatibles">
              <P>En el archivo de configuración de servidores MCP:</P>
              <Pre>{`{
  "mcpServers": {
    "riverz": {
      "type": "http",
      "url": "https://riverz.co/api/mcp",
      "headers": { "Authorization": "Bearer TU_LLAVE" }
    }
  }
}`}</Pre>
            </Card>

            <Card title="Terminal (Claude Code)">
              <P>Un solo comando:</P>
              <Pre>{`claude mcp add --transport http riverz https://riverz.co/api/mcp \\
  --header "Authorization: Bearer TU_LLAVE"`}</Pre>
              <P>
                La cabecera no es opcional. Sin ella el cliente informa que quedó conectado y
                después cada herramienta falla.
              </P>
            </Card>

            <Card title="Cualquier otro cliente">
              <P>
                El servidor habla JSON-RPC 2.0 sobre HTTP POST. Así se listan las herramientas
                disponibles:
              </P>
              <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer TU_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</Pre>
              <P>
                Y así se llama una. No hace falta enviar <Code>workspace_id</Code>, porque el
                servidor lo toma de la llave.
              </P>
              <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer TU_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": { "name": "conversaciones_pendientes", "arguments": {} }
  }'`}</Pre>
            </Card>

            <Card title="Sin llave, con OAuth">
              <P>
                Los clientes que saben descubrir un servidor MCP por su cuenta no necesitan que se
                les pegue nada: se les da la dirección y abren una pantalla de Riverz donde la
                persona autoriza el acceso.
              </P>
              <Pre>https://riverz.co/api/mcp</Pre>
              <P>
                El recorrido completo está más abajo, en <A href="#oauth">OAuth</A>.
              </P>
            </Card>
          </Paso>
        </Section>

        {/* ── Herramientas ─────────────────────────────────────────── */}
        <Section id="herramientas" title="Herramientas">
          <P>
            Las {tools.length} herramientas que Riverz expone. La lista se genera del código que
            corre en producción, así que no puede quedar desactualizada.
          </P>
          <P>
            <Code>workspace_id</Code> aparece en varios esquemas porque el servidor lo utiliza
            internamente, pero no hace falta enviarlo: se toma de la llave. Si se envía uno que no
            corresponde, la llamada se rechaza.
          </P>

          {GRUPOS.map((g) => {
            const lista = tools.filter((t) => t.risk === g.risk);
            if (lista.length === 0) return null;
            return (
              <div key={g.id} id={g.id} className="scroll-mt-24 pt-10">
                <H3>{g.label}</H3>
                <P>{g.nota}</P>
                <ToolTable>
                  {lista.map((t) => {
                    const props = Object.keys(t.schema.properties ?? {}).filter(
                      (k) => k !== 'workspace_id',
                    );
                    const req = (t.schema.required ?? []).filter((k) => k !== 'workspace_id');
                    return (
                      <ToolRow
                        key={t.name}
                        name={t.name}
                        description={t.description}
                        params={
                          props.length
                            ? props
                                .map((p) => (req.includes(p) ? `${p} (obligatorio)` : p))
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
        <Section id="oauth" title="OAuth">
          <P>
            Para los clientes que descubren el servidor por su cuenta. No se les pega ninguna
            llave: reciben la dirección y abren una pantalla de Riverz donde la persona autoriza el
            acceso. Si el cliente sabe enviar una cabecera <Code>Authorization</Code>, esta vía no
            es necesaria.
          </P>

          <H3>El recorrido</H3>
          <UL>
            <LI>
              El cliente llama a <Code>https://riverz.co/api/mcp</Code> sin credencial y recibe un
              401 con una cabecera <Code>WWW-Authenticate</Code> que apunta al documento de
              descubrimiento.
            </LI>
            <LI>
              De ese documento obtiene el servidor de autorización y se registra solo en{' '}
              <Code>/api/oauth/register</Code>. Nadie de Riverz tiene que crear nada a mano.
            </LI>
            <LI>
              Abre <Code>/oauth/autorizar</Code>. La pantalla muestra qué aplicación pide acceso,
              sobre qué cuenta y qué podrá hacer. Si no hay sesión iniciada, primero se inicia y
              luego se vuelve a esa misma pantalla.
            </LI>
            <LI>
              Con la autorización concedida, el cliente recibe un código y lo canjea por un token
              en <Code>/api/oauth/token</Code>.
            </LI>
          </UL>

          <H3>Documentos de descubrimiento</H3>
          <Pre>{`GET https://riverz.co/.well-known/oauth-protected-resource
GET https://riverz.co/.well-known/oauth-authorization-server`}</Pre>
          <P>Ambos son públicos: describen cómo pedir permiso, no conceden ninguno.</P>

          <H3>PKCE obligatorio, únicamente S256</H3>
          <P>
            No hay secreto de cliente. Como los clientes se registran solos, el{' '}
            <Code>client_id</Code> no prueba identidad: lo único que vincula el canje con quien
            pidió el código es el <Code>code_verifier</Code>. Cualquier{' '}
            <Code>code_challenge_method</Code> distinto de <Code>S256</Code> se rechaza.
          </P>

          <H3>Las redirecciones se comparan de forma exacta</H3>
          <P>
            Deben coincidir carácter por carácter con alguna de las registradas. No se admiten
            prefijos ni comodines, porque aceptar coincidencias parciales es el mecanismo con el
            que se interceptan códigos de autorización. Se admite <Code>https</Code>, y{' '}
            <Code>http</Code> solamente en localhost, ya que un cliente de escritorio no puede
            tener un certificado.
          </P>

          <H3>Alcances</H3>
          <UL>
            <LI>
              <Code>mcp:read</Code>. Consulta la operación sin modificar nada.
            </LI>
            <LI>
              <Code>mcp:write</Code>. Además permite actuar. Las acciones irreversibles siguen
              pidiendo confirmación.
            </LI>
          </UL>
          <P>
            Si no se pide ningún alcance se concede el más restrictivo. Un cliente que no declaró
            qué necesita, no necesita escribir.
          </P>

          <H3>El token vence en una hora</H3>
          <P>
            Es deliberado: si se filtra, la ventana de exposición es corta. El{' '}
            <Code>refresh_token</Code> permite obtener uno nuevo sin volver a molestar a la persona.
          </P>
          <Pre>{`POST https://riverz.co/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=...&client_id=...`}</Pre>
          <P>
            El acceso se revoca desde Ajustes, Agentes (MCP), igual que una llave pegada a mano.
            Para Riverz las dos vías producen lo mismo: un token asociado a una cuenta y a un
            alcance.
          </P>
        </Section>

        {/* ── Seguridad ────────────────────────────────────────────── */}
        <Section id="seguridad" title="Seguridad">
          <H3>La llave lleva la cuenta adentro</H3>
          <P>
            Cada llave está asociada a una única cuenta. Si un agente envía un{' '}
            <Code>workspace_id</Code> distinto, la llamada se rechaza. No se ignora en silencio,
            porque un agente que cree estar operando sobre otra cuenta debe enterarse en vez de
            deducirlo por los resultados. La herramienta que lista cuentas devuelve solamente la
            propia.
          </P>

          <H3>Se almacena un hash, no la llave</H3>
          <P>
            Lo que queda guardado es un SHA-256. Si alguien obtuviera una copia de la base de datos
            no obtendría llaves utilizables, y por el mismo motivo Riverz tampoco puede volver a
            mostrarla.
          </P>

          <H3>Sólo lectura de forma predeterminada</H3>
          <P>
            Una llave capaz de escribirle a un cliente y otra que sólo responde consultas no
            representan el mismo riesgo si se filtran. Por eso el valor predeterminado al crearla
            es sólo lectura, y la capacidad de escribir se pide de forma explícita.
          </P>

          <H3>Las acciones irreversibles piden confirmación</H3>
          <P>
            Enviar un mensaje a una persona no se ejecuta en la primera llamada: el servidor
            devuelve qué haría junto con un <Code>confirm_token</Code> válido por cinco minutos, y
            sólo con ese token en una segunda llamada la acción se ejecuta. El token se firma junto
            con los argumentos, así que cambiar el texto después de que alguien lo aprobó lo
            invalida.
          </P>
          <P>
            Conviene entender qué cubre esa protección. La confirmación protege frente a un error,
            no frente a una llave filtrada. Para eso sirven el alcance de sólo lectura y la
            revocación.
          </P>

          <H3>Todo queda registrado</H3>
          <P>
            Cada llamada se anota, incluidas las lecturas y los intentos rechazados. Cuando se trata
            de datos de personas, saber quién consultó qué forma parte de la respuesta. El registro
            se ve en Ajustes, Agentes (MCP).
          </P>
          <P>
            Lo que ese registro no guarda: el teléfono de un contacto o el texto de un mensaje. Se
            anota qué campos se usaron, nunca su contenido.
          </P>

          <H3>Límites</H3>
          <UL>
            <LI>60 llamadas por minuto y por llave.</LI>
            <LI>Diez llaves activas por cuenta.</LI>
            <LI>Los tokens de OAuth vencen en una hora y se renuevan con el refresh.</LI>
          </UL>
        </Section>

        {/* ── Errores ──────────────────────────────────────────────── */}
        <Section id="errores" title="Errores frecuentes">
          <ToolTable>
            <ToolRow
              name="-32001"
              description="Clave inválida o ausente. La llave es incorrecta, venció o fue revocada."
            />
            <ToolRow
              name="-32003"
              description="La llave sólo opera sobre su propia cuenta, o es de sólo lectura y la herramienta modifica algo. En el primer caso conviene omitir workspace_id, porque el servidor lo completa."
            />
            <ToolRow
              name="-32005"
              description="Se superaron las 60 llamadas por minuto con la misma llave."
            />
            <ToolRow
              name="-32601"
              description="La herramienta no existe con esta llave. Las del equipo de Riverz no están disponibles para una cuenta."
            />
          </ToolTable>
        </Section>
      </article>
    </>
  );
}
