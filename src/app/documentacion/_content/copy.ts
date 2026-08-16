import type { Locale } from '@/lib/i18n/config';

/**
 * El texto de la documentación, en los dos idiomas.
 *
 * Va acá y no en `src/lib/i18n/messages/` por una diferencia de forma: aquellos
 * catálogos son etiquetas de interfaz, cientos de cadenas cortas que se buscan
 * por clave desde cualquier pantalla. Esto son párrafos largos que sólo lee una
 * página, y meterlos ahí ensuciaría el catálogo que usa toda la app. La forma
 * `{ es, en }` sí es la misma, para que se vea de un vistazo cuándo un idioma
 * quedó atrás.
 *
 * Los párrafos aceptan un marcado mínimo que resuelve `<Rich>`: acentos graves
 * para código, dos asteriscos para negrita y corchetes con paréntesis para
 * enlaces. Sin eso, cada oración con un nombre de campo adentro habría que
 * partirla en tres cadenas y traducirla a ciegas.
 */
type Par = { es: string; en: string };

export const DOCS = {
  // ── Marco ──────────────────────────────────────────────────────────
  metaTitle: {
    es: 'Riverz Docs · Conector MCP',
    en: 'Riverz Docs · MCP connector',
  },
  metaDesc: {
    es: 'Cómo conectar tu propio agente a Riverz por MCP: llaves, OAuth y todas las herramientas.',
    en: 'How to connect your own agent to Riverz over MCP: keys, OAuth and every tool.',
  },
  goToSettings: { es: 'Ir a Ajustes', en: 'Go to Settings' },
  copyAll: { es: 'Copiar todo', en: 'Copy everything' },
  copied: { es: 'Copiado', en: 'Copied' },
  navTitle: { es: 'Conector MCP', en: 'MCP connector' },
  eyebrow: { es: 'Documentación', en: 'Documentation' },
  /** El hueco donde va la llave en los ejemplos. */
  keyPlaceholder: { es: 'TU_LLAVE', en: 'YOUR_KEY' },

  // ── Portada ────────────────────────────────────────────────────────
  title: {
    es: 'Usa Riverz desde tu asistente de IA',
    en: 'Use Riverz from your AI assistant',
  },
  lead: {
    es: 'Riverz habla MCP. Con una llave, cualquier asistente que soporte el protocolo puede consultar la operación de la cuenta y actuar sobre ella: qué conversaciones quedaron sin responder, por qué un mensaje no llegó, cómo terminó una campaña, o escribirle a un cliente.',
    en: 'Riverz speaks MCP. With a key, any assistant that supports the protocol can query the account and act on it: which conversations went unanswered, why a message never arrived, how a campaign ended, or message a customer.',
  },

  // ── Conexión ───────────────────────────────────────────────────────
  connTitle: { es: 'Conexión', en: 'Connecting' },
  connIntro: {
    es: 'Son dos pasos. El primero se hace una sola vez y el segundo depende de qué cliente se use.',
    en: 'Two steps. The first happens once; the second depends on which client you use.',
  },
  connWarn: {
    es: '**Importante:** pegar esta página dentro de un chat no conecta nada. Conectar un asistente a tus datos exige una acción explícita en sus ajustes. Es una medida del protocolo, no un límite de Riverz.',
    en: '**Important:** pasting this page into a chat connects nothing. Connecting an assistant to your data requires an explicit action in its own settings. That is a protocol safeguard, not a Riverz limitation.',
  },

  step1Eyebrow: { es: 'Una sola vez', en: 'Once only' },
  step1Title: { es: 'Crea tu llave en Riverz', en: 'Create your key in Riverz' },
  step1a: {
    es: 'En **Ajustes, Agentes (MCP)**. Conviene ponerle un nombre que diga dónde va a estar instalada, por ejemplo "laptop de Juan" o "n8n": ese nombre es lo que permite revocar una llave concreta sin tocar las demás.',
    en: 'Under **Settings, Agents (MCP)**. Give it a name that says where it will live, for example "Juan’s laptop" or "n8n": that name is what lets you revoke one key without touching the rest.',
  },
  step1b: {
    es: 'Después se elige el alcance. **Sólo lectura** consulta la operación sin modificar nada. **Lectura y escritura** además permite activar automatizaciones y enviar mensajes.',
    en: 'Then choose the scope. **Read only** queries the account without changing anything. **Read and write** also lets it turn automations on and send messages.',
  },
  step1c: {
    es: 'El valor se muestra **una sola vez**. No es una limitación de la interfaz: en la base de datos se guarda un hash, de modo que Riverz tampoco puede volver a mostrarlo. Si se pierde, se revoca y se crea otra.',
    en: 'The value is shown **once**. That is not an interface limitation: the database stores a hash, so Riverz cannot show it again either. If you lose it, revoke it and create another.',
  },
  step1Link: { es: 'Crear una llave en Ajustes', en: 'Create a key in Settings' },

  step2Eyebrow: { es: 'Según el cliente', en: 'Depends on the client' },
  step2Title: {
    es: 'Pega la llave en tu asistente',
    en: 'Paste the key into your assistant',
  },

  cardDesktop: {
    es: 'Claude Desktop, Cursor y compatibles',
    en: 'Claude Desktop, Cursor and compatible clients',
  },
  cardDesktopP: {
    es: 'En el archivo de configuración de servidores MCP:',
    en: 'In the MCP servers configuration file:',
  },
  cardTerminal: { es: 'Terminal (Claude Code)', en: 'Terminal (Claude Code)' },
  cardTerminalP: { es: 'Un solo comando:', en: 'A single command:' },
  cardTerminalNote: {
    es: 'La cabecera no es opcional. Sin ella el cliente informa que quedó conectado y después cada herramienta falla.',
    en: 'The header is not optional. Without it the client reports a successful connection and then every tool fails.',
  },
  cardOther: { es: 'Cualquier otro cliente', en: 'Any other client' },
  cardOtherP: {
    es: 'El servidor habla JSON-RPC 2.0 sobre HTTP POST. Así se listan las herramientas disponibles:',
    en: 'The server speaks JSON-RPC 2.0 over HTTP POST. This lists the available tools:',
  },
  cardOtherP2: {
    es: 'Y así se llama una. No hace falta enviar `workspace_id`, porque el servidor lo toma de la llave.',
    en: 'And this calls one. There is no need to send `workspace_id`: the server takes it from the key.',
  },
  cardOauth: { es: 'Sin llave, con OAuth', en: 'No key, with OAuth' },
  cardOauthP: {
    es: 'Los clientes que saben descubrir un servidor MCP por su cuenta no necesitan que se les pegue nada: se les da la dirección y abren una pantalla de Riverz donde la persona autoriza el acceso.',
    en: 'Clients that can discover an MCP server on their own need nothing pasted: give them the address and they open a Riverz screen where the person grants access.',
  },
  cardOauthP2: {
    es: 'El recorrido completo está más abajo, en [OAuth](#oauth).',
    en: 'The full flow is further down, under [OAuth](#oauth).',
  },

  // ── Herramientas ───────────────────────────────────────────────────
  toolsTitle: { es: 'Herramientas', en: 'Tools' },
  toolsIntro: {
    es: 'Las {n} herramientas que Riverz expone. La lista se genera del código que corre en producción, así que no puede quedar desactualizada.',
    en: 'The {n} tools Riverz exposes. The list is generated from the code running in production, so it cannot fall out of date.',
  },
  toolsWorkspace: {
    es: '`workspace_id` aparece en varios esquemas porque el servidor lo utiliza internamente, pero no hace falta enviarlo: se toma de la llave. Si se envía uno que no corresponde, la llamada se rechaza.',
    en: '`workspace_id` shows up in several schemas because the server uses it internally, but you never send it: it comes from the key. Sending one that does not match rejects the call.',
  },
  groupRead: { es: 'Consulta', en: 'Read' },
  groupReadNote: {
    es: 'No modifican nada. Disponibles con cualquier llave.',
    en: 'They change nothing. Available with any key.',
  },
  groupWrite: { es: 'Acción', en: 'Action' },
  groupWriteNote: {
    es: 'Modifican algo que se puede deshacer. Requieren una llave de lectura y escritura.',
    en: 'They change something you can undo. They require a read and write key.',
  },
  groupConfirm: { es: 'Con confirmación', en: 'Needs confirmation' },
  groupConfirmNote: {
    es: 'Su efecto llega a una persona. Requieren llave de escritura y además un segundo llamado con el token de confirmación.',
    en: 'Their effect reaches a person. They require a write key plus a second call carrying the confirmation token.',
  },
  required: { es: 'obligatorio', en: 'required' },

  // ── OAuth ──────────────────────────────────────────────────────────
  oauthTitle: { es: 'OAuth', en: 'OAuth' },
  oauthIntro: {
    es: 'Para los clientes que descubren el servidor por su cuenta. No se les pega ninguna llave: reciben la dirección y abren una pantalla de Riverz donde la persona autoriza el acceso. Si el cliente sabe enviar una cabecera `Authorization`, esta vía no es necesaria.',
    en: 'For clients that discover the server on their own. Nothing gets pasted into them: they receive the address and open a Riverz screen where the person grants access. If the client can send an `Authorization` header, this path is unnecessary.',
  },
  oauthFlow: { es: 'El recorrido', en: 'The flow' },
  oauthFlow1: {
    es: 'El cliente llama a `https://riverz.co/api/mcp` sin credencial y recibe un 401 con una cabecera `WWW-Authenticate` que apunta al documento de descubrimiento.',
    en: 'The client calls `https://riverz.co/api/mcp` with no credential and gets a 401 with a `WWW-Authenticate` header pointing at the discovery document.',
  },
  oauthFlow2: {
    es: 'De ese documento obtiene el servidor de autorización y se registra solo en `/api/oauth/register`. Nadie de Riverz tiene que crear nada a mano.',
    en: 'From that document it finds the authorization server and registers itself at `/api/oauth/register`. Nobody at Riverz has to create anything by hand.',
  },
  oauthFlow3: {
    es: 'Abre `/oauth/autorizar`. La pantalla muestra qué aplicación pide acceso, sobre qué cuenta y qué podrá hacer. Si no hay sesión iniciada, primero se inicia y luego se vuelve a esa misma pantalla.',
    en: 'It opens `/oauth/autorizar`. The screen shows which application is asking, for which account, and what it will be able to do. With no session, you sign in first and land back on that same screen.',
  },
  oauthFlow4: {
    es: 'Con la autorización concedida, el cliente recibe un código y lo canjea por un token en `/api/oauth/token`.',
    en: 'Once granted, the client receives a code and exchanges it for a token at `/api/oauth/token`.',
  },
  oauthDiscovery: { es: 'Documentos de descubrimiento', en: 'Discovery documents' },
  oauthDiscoveryP: {
    es: 'Ambos son públicos: describen cómo pedir permiso, no conceden ninguno.',
    en: 'Both are public: they describe how to ask for access, they grant none.',
  },
  oauthPkce: { es: 'PKCE obligatorio, únicamente S256', en: 'PKCE required, S256 only' },
  oauthPkceP: {
    es: 'No hay secreto de cliente. Como los clientes se registran solos, el `client_id` no prueba identidad: lo único que vincula el canje con quien pidió el código es el `code_verifier`. Cualquier `code_challenge_method` distinto de `S256` se rechaza.',
    en: 'There is no client secret. Since clients register themselves, `client_id` proves nothing about identity: the only thing tying the exchange to whoever asked for the code is the `code_verifier`. Any `code_challenge_method` other than `S256` is rejected.',
  },
  oauthRedirect: {
    es: 'Las redirecciones se comparan de forma exacta',
    en: 'Redirect URIs are matched exactly',
  },
  oauthRedirectP: {
    es: 'Deben coincidir carácter por carácter con alguna de las registradas. No se admiten prefijos ni comodines, porque aceptar coincidencias parciales es el mecanismo con el que se interceptan códigos de autorización. Se admite `https`, y `http` solamente en localhost, ya que un cliente de escritorio no puede tener un certificado.',
    en: 'They must match one of the registered URIs character for character. No prefixes, no wildcards: accepting partial matches is precisely how authorization codes get intercepted. `https` is allowed, and `http` only on localhost, since a desktop client cannot hold a certificate.',
  },
  oauthScopes: { es: 'Alcances', en: 'Scopes' },
  oauthScopeRead: {
    es: '`mcp:read`. Consulta la operación sin modificar nada.',
    en: '`mcp:read`. Queries the account without changing anything.',
  },
  oauthScopeWrite: {
    es: '`mcp:write`. Además permite actuar. Las acciones irreversibles siguen pidiendo confirmación.',
    en: '`mcp:write`. Also allows acting. Irreversible actions still ask for confirmation.',
  },
  oauthScopeDefault: {
    es: 'Si no se pide ningún alcance se concede el más restrictivo. Un cliente que no declaró qué necesita, no necesita escribir.',
    en: 'If no scope is requested, the most restrictive one is granted. A client that did not state what it needs does not need to write.',
  },
  oauthTtl: { es: 'El token vence en una hora', en: 'The token expires in an hour' },
  oauthTtlP: {
    es: 'Es deliberado: si se filtra, la ventana de exposición es corta. El `refresh_token` permite obtener uno nuevo sin volver a molestar a la persona.',
    en: 'That is deliberate: if it leaks, the exposure window is short. The `refresh_token` gets a new one without bothering the person again.',
  },
  oauthRevoke: {
    es: 'El acceso se revoca desde Ajustes, Agentes (MCP), igual que una llave pegada a mano. Para Riverz las dos vías producen lo mismo: un token asociado a una cuenta y a un alcance.',
    en: 'Access is revoked under Settings, Agents (MCP), the same as a hand pasted key. To Riverz both paths produce the same thing: a token bound to an account and a scope.',
  },

  // ── Seguridad ──────────────────────────────────────────────────────
  secTitle: { es: 'Seguridad', en: 'Security' },
  secTenant: {
    es: 'La llave lleva la cuenta adentro',
    en: 'The key carries the account inside it',
  },
  secTenantP: {
    es: 'Cada llave está asociada a una única cuenta. Si un agente envía un `workspace_id` distinto, la llamada se rechaza. No se ignora en silencio, porque un agente que cree estar operando sobre otra cuenta debe enterarse en vez de deducirlo por los resultados. La herramienta que lista cuentas devuelve solamente la propia.',
    en: 'Every key is bound to one account. If an agent sends a different `workspace_id`, the call is rejected. It is not silently ignored: an agent that believes it is working on another account should be told, not left to infer it from the results. The tool that lists accounts returns only its own.',
  },
  secHash: { es: 'Se almacena un hash, no la llave', en: 'A hash is stored, not the key' },
  secHashP: {
    es: 'Lo que queda guardado es un SHA-256. Si alguien obtuviera una copia de la base de datos no obtendría llaves utilizables, y por el mismo motivo Riverz tampoco puede volver a mostrarla.',
    en: 'What is stored is a SHA-256. Anyone who obtained a copy of the database would not obtain usable keys, and for the same reason Riverz cannot show one again either.',
  },
  secRead: { es: 'Sólo lectura de forma predeterminada', en: 'Read only by default' },
  secReadP: {
    es: 'Una llave capaz de escribirle a un cliente y otra que sólo responde consultas no representan el mismo riesgo si se filtran. Por eso el valor predeterminado al crearla es sólo lectura, y la capacidad de escribir se pide de forma explícita.',
    en: 'A key that can message a customer and a key that only answers questions do not carry the same risk if they leak. That is why the default when creating one is read only, and the ability to write is asked for explicitly.',
  },
  secConfirm: {
    es: 'Las acciones irreversibles piden confirmación',
    en: 'Irreversible actions ask for confirmation',
  },
  secConfirmP: {
    es: 'Enviar un mensaje a una persona no se ejecuta en la primera llamada: el servidor devuelve qué haría junto con un `confirm_token` válido por cinco minutos, y sólo con ese token en una segunda llamada la acción se ejecuta. El token se firma junto con los argumentos, así que cambiar el texto después de que alguien lo aprobó lo invalida.',
    en: 'Sending a message to a person does not run on the first call: the server returns what it would do along with a `confirm_token` valid for five minutes, and only that token on a second call executes it. The token is signed together with the arguments, so changing the text after someone approved it invalidates it.',
  },
  secConfirmP2: {
    es: 'Conviene entender qué cubre esa protección. La confirmación protege frente a un error, no frente a una llave filtrada. Para eso sirven el alcance de sólo lectura y la revocación.',
    en: 'It is worth knowing what that protects against. Confirmation guards against a mistake, not against a leaked key. Read only scope and revocation are what guard against that.',
  },
  secAudit: { es: 'Todo queda registrado', en: 'Everything is logged' },
  secAuditP: {
    es: 'Cada llamada se anota, incluidas las lecturas y los intentos rechazados. Cuando se trata de datos de personas, saber quién consultó qué forma parte de la respuesta. El registro se ve en Ajustes, Agentes (MCP).',
    en: 'Every call is recorded, including reads and rejected attempts. When personal data is involved, knowing who looked at what is part of the answer. The log is visible under Settings, Agents (MCP).',
  },
  secAuditP2: {
    es: 'Lo que ese registro no guarda: el teléfono de un contacto o el texto de un mensaje. Se anota qué campos se usaron, nunca su contenido.',
    en: 'What that log does not keep: a contact’s phone number or the text of a message. It records which fields were used, never their contents.',
  },
  secLimits: { es: 'Límites', en: 'Limits' },
  secLimit1: { es: '60 llamadas por minuto y por llave.', en: '60 calls per minute per key.' },
  secLimit2: { es: 'Diez llaves activas por cuenta.', en: 'Ten active keys per account.' },
  secLimit3: {
    es: 'Los tokens de OAuth vencen en una hora y se renuevan con el refresh.',
    en: 'OAuth tokens expire in an hour and are renewed with the refresh token.',
  },

  // ── Errores ────────────────────────────────────────────────────────
  errTitle: { es: 'Errores frecuentes', en: 'Common errors' },
  err32001: {
    es: 'Clave inválida o ausente. La llave es incorrecta, venció o fue revocada.',
    en: 'Invalid or missing key. The key is wrong, expired or revoked.',
  },
  err32003: {
    es: 'La llave sólo opera sobre su propia cuenta, o es de sólo lectura y la herramienta modifica algo. En el primer caso conviene omitir workspace_id, porque el servidor lo completa.',
    en: 'The key only operates on its own account, or it is read only and the tool changes something. In the first case omit workspace_id: the server fills it in.',
  },
  err32005: {
    es: 'Se superaron las 60 llamadas por minuto con la misma llave.',
    en: 'More than 60 calls in one minute with the same key.',
  },
  err32601: {
    es: 'La herramienta no existe con esta llave. Las del equipo de Riverz no están disponibles para una cuenta.',
    en: 'The tool does not exist for this key. The ones belonging to the Riverz team are not available to an account.',
  },
} satisfies Record<string, Par>;

export type DocsKey = keyof typeof DOCS;

/** El texto de una clave en el idioma pedido. */
export function d(locale: Locale, key: DocsKey, vars?: Record<string, string | number>): string {
  const raw = DOCS[key][locale];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k) => String(vars[k] ?? m));
}
