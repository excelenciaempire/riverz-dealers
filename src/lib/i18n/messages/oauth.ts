import type { Namespace } from './types';

/**
 * La pantalla donde una persona le da acceso a su cuenta a un programa.
 *
 * Es la única de todo el flujo de OAuth que se ve, así que dice qué se está
 * concediendo en vez de pedir un "autorizar" a ciegas. La diferencia entre leer
 * y escribir está separada a propósito: una consulta y un mensaje que le llega
 * a un cliente real no son lo mismo.
 */
export const oauth: Namespace = {
  connectWith: { es: 'Conectar con {client}', en: 'Connect with {client}' },
  openClient: { es: 'Abrir {client}', en: 'Open {client}' },
  stepAdd: { es: 'Añadir la app', en: 'Add the app' },
  stepAuthorize: { es: 'Autorizar', en: 'Authorize' },
  stepVerify: { es: 'Comprobar la conexión', en: 'Verify the connection' },
  reuseExisting: { es: 'Si ya tienes Riverz con esta dirección, abre esa conexión. Conserva tus demás servidores.', en: 'If Riverz already uses this address, open that connection. Keep your other servers.' },
  addClaudeExact: { es: 'El formulario lleva Riverz y su dirección. Si no aparecen: Personalizar → Conectores → + → Agregar conector personalizado; nombre Riverz y pega esta dirección.', en: 'The form includes Riverz and its address. If missing: Customize → Connectors → + → Add custom connector; name Riverz and paste this address.' },
  addChatgptExact: { es: 'En ChatGPT, pulsa + → Crear MCP App (Create MCP App). Nombre: Riverz. En Conexión, pega esta dirección y elige OAuth.', en: 'In ChatGPT, select + → Create MCP App. Name: Riverz. Under Connection, paste this address and choose OAuth.' },
  addCodexExact: { es: 'En la app de escritorio: Ajustes → Servidores MCP → Añadir servidor → Streamable HTTP. Nombre: Riverz; pega esta dirección. Guarda, reinicia y pulsa Autenticar. Si existe la misma URL, reutiliza ese servidor.', en: 'In the desktop app: Settings → MCP servers → Add server → Streamable HTTP. Name: Riverz; paste this address. Save, restart and select Authenticate. Reuse a server with the same URL.' },
  signInNow: { es: 'En Claude elige Iniciar sesión ahora. En la ventana de Riverz, comprueba tu correo y cuenta y pulsa Autorizar.', en: 'In Claude choose Sign in now. In Riverz, check your email and account, then select Authorize.' },
  authorizeExact: { es: 'Revisa el aviso de confianza del asistente y crea la conexión. Cuando Riverz se abra, comprueba tu correo y cuenta y pulsa Autorizar.', en: 'Review the assistant’s trust notice and create the connection. When Riverz opens, check your email and account, then select Authorize.' },
  trustNotice: { es: 'Claude mostrará un aviso de confianza. Revisa que la dirección sea riverz.co y decide si continuar; ese aviso no es un error de Riverz.', en: 'Claude shows a trust notice. Check that the address is riverz.co and decide whether to continue; this notice is not a Riverz error.' },
  verifyExact: { es: 'Activa Riverz en un chat de {client}, pega esta solicitud y envíala. La comprobación vence en 15 minutos.', en: 'Enable Riverz in a {client} chat, paste this request and send it. The check expires in 15 minutes.' },
  verifyPrompt: { es: 'Usa la conexión Riverz y llama a comprobar_conexion con codigo "{code}". No simules el resultado: realiza la llamada a la herramienta.', en: 'Use the Riverz connection and call comprobar_conexion with codigo "{code}". Do not simulate the result: make the tool call.' },
  copyCheck: { es: 'Copiar solicitud de comprobación', en: 'Copy verification request' },
  retryCheck: { es: 'Crear nueva comprobación', en: 'Create a new check' },
  check_waiting: { es: 'Esperando autorización y comprobación', en: 'Waiting for authorization and verification' },
  check_authorized: { es: 'Hay acceso autorizado. Envía la comprobación en tu asistente.', en: 'Authorized access exists. Send the verification request in your assistant.' },
  check_verified: { es: 'Conexión comprobada', en: 'Connection verified' },
  check_expired: { es: 'La comprobación venció. Crea una nueva y envíala en tu asistente.', en: 'The check expired. Create a new one and send it in your assistant.' },
  check_error: { es: 'No se pudo comprobar. Reintentando; si persiste, crea una nueva comprobación.', en: 'Could not verify. Retrying; if it persists, create a new check.' },
  realCallVerified: { es: 'Riverz recibió una llamada autenticada de tu usuario y tu cuenta.', en: 'Riverz received an authenticated tool call from your user and account.' },
  surfaceLimits: { es: 'Codex, otras superficies y requisitos', en: 'Codex, other surfaces and requirements' },
  claudeLimits: { es: 'El conector de Claude web también está disponible en Claude Desktop y Claude Code con la misma cuenta de Claude y cuando tu organización lo permita. La configuración local de Claude Code no se instala en la web.', en: 'A Claude web connector is also available in Claude Desktop and Claude Code with the same Claude account and when organization policy permits. Local Claude Code configuration is not installed on the web.' },
  openaiLimits: { es: 'ChatGPT web y la configuración MCP local de Codex son recorridos distintos. Los clientes de escritorio, CLI e IDE del mismo equipo comparten configuración local; comprueba cada superficie por separado.', en: 'ChatGPT web and local Codex MCP configuration are separate paths. Desktop, CLI and IDE clients on the same host share local configuration; verify each surface separately.' },
  planLimits: { es: 'Si no puedes crear una conexión, tu plan o espacio puede limitarla. En ChatGPT revisa Ajustes → Seguridad e inicio de sesión → Modo desarrollador. En Claude Team/Enterprise, el dueño debe añadir el conector; cada persona autoriza su propio acceso.', en: 'If you cannot create a connection, your plan or workspace may restrict it. In ChatGPT check Settings → Security and login → Developer mode. In Claude Team/Enterprise, an owner must add the connector; each person authorizes their own access.' },
  localSeparate: { es: 'Configuración local avanzada. No sincroniza automáticamente con los chats web. No reemplaces servidores que tengan otra dirección.', en: 'Advanced local configuration. It does not automatically sync with web chats. Do not replace servers with a different address.' },
  teamPermissions: { es: 'El acceso respeta tus permisos actuales del equipo. Una conexión no concede permisos nuevos.', en: 'Access follows your current team permissions. Connecting does not grant new permissions.' },
  restrictedRead: { es: 'Consultar únicamente las secciones que tu equipo te permite ver.', en: 'Read only the sections your team allows you to access.' },
  connectTitle: { es: 'Elige tu asistente', en: 'Choose your assistant' },
  addToClient: { es: 'Añadir a {client}', en: 'Add to {client}' },
  useClient: { es: 'Usar {client}', en: 'Use {client}' },
  desktopDirectSteps: {
    es: 'En {client}, pulsa Enviar en la solicitud que ya está preparada. Autoriza tu cuenta de Riverz cuando se abra el inicio de sesión.',
    en: 'In {client}, send the request that is already prepared. Authorize your Riverz account when sign-in opens.',
  },
  desktopDidNotOpen: { es: '¿No se abrió la app?', en: 'App did not open?' },
  desktopRequired: {
    es: 'Necesitas {client} instalado en este equipo. También puedes usar la opción web de la tarjeta o abrir Configuración manual.',
    en: 'You need {client} installed on this computer. You can also use the card’s web option or open Manual setup.',
  },
  downloadClient: { es: 'Descargar {client}', en: 'Download {client}' },
  claudeCard: {
    es: 'También disponible en Claude Code.',
    en: 'Also available in Claude Code.',
  },
  chatgptCard: {
    es: 'Tu negocio en tus conversaciones.',
    en: 'Your business in your conversations.',
  },
  otherAssistants: { es: 'Otros asistentes', en: 'Other assistants' },
  manageClient: { es: 'Abrir {client}', en: 'Open {client}' },
  connectedClient: {
    es: '{client} está conectado',
    en: '{client} is connected',
  },
  finishClient: {
    es: 'Completa la conexión en {client}',
    en: 'Finish connecting in {client}',
  },
  closeHelp: { es: 'Cerrar ayuda de conexión', en: 'Close connection help' },
  claudeQuickSteps: {
    es: 'Riverz ya está rellenado. Confirma que quieres agregarlo y autoriza tu cuenta de Riverz. Si Claude te pide iniciar sesión, vuelve a pulsar Añadir a Claude aquí.',
    en: 'Riverz is already filled in. Confirm you want to add it and authorize your Riverz account. If Claude asks you to sign in, select Add to Claude here again.',
  },
  chatgptQuickAdd: {
    es: 'En el formulario que se abre, escribe Riverz como nombre y pega la dirección de abajo.',
    en: 'In the form that opens, enter Riverz as the name and paste the address below.',
  },
  chatgptQuickOpen: {
    es: 'Si no se abre el formulario, en ChatGPT pulsa Agregar → Crear MCP App.',
    en: 'If the form does not open, in ChatGPT select Add → Create MCP App.',
  },
  chatgptQuickAuthorize: {
    es: 'Deja OAuth seleccionado, confirma que quieres continuar y pulsa Crear. Autoriza tu cuenta de Riverz.',
    en: 'Keep OAuth selected, confirm you want to continue and select Create. Authorize your Riverz account.',
  },
  connectionReturn: {
    es: 'Al terminar, vuelve aquí para comprobar la conexión.',
    en: 'When finished, return here to check the connection.',
  },
  connected: { es: 'Conectado', en: 'Connected' },
  waitingForClient: {
    es: 'Esperando la conexión del asistente',
    en: 'Waiting for the assistant to connect',
  },
  statusFailed: {
    es: 'No se pudo comprobar la conexión. Reintentando…',
    en: 'Could not verify the connection. Retrying…',
  },
  connectDescription: {
    es: 'Autoriza el acceso a Riverz sin crear una llave.',
    en: 'Authorize access to Riverz without creating a key.',
  },
  connectClient: { es: 'Conectar {client}', en: 'Connect {client}' },
  chooseClient: {
    es: 'Conectar desde',
    en: 'Connect from',
  },
  claudeSharedConnection: {
    es: 'La conexión de tu cuenta también funciona en Claude Code con la misma cuenta.',
    en: 'Your account connection also works in Claude Code with the same account.',
  },
  claudeAddServer: {
    es: 'En Claude, abre Personalizar → Conectores y pulsa + → Agregar conector personalizado.',
    en: 'In Claude, open Customize → Connectors and select + → Add custom connector.',
  },
  copyAndOpenClaude: {
    es: 'Copiar URL y abrir conectores de Claude',
    en: 'Copy URL and open Claude connectors',
  },
  claudeUrlCopied: {
    es: 'URL copiada: pégala en Claude.',
    en: 'URL copied: paste it in Claude.',
  },
  claudeAuthorize: {
    es: 'Pulsa Agregar y luego Conectar. Inicia sesión en Riverz y autoriza el acceso.',
    en: 'Select Add, then Connect. Sign in to Riverz and authorize access.',
  },
  chatgptWeb: { es: 'ChatGPT web', en: 'ChatGPT web' },
  openDesktop: {
    es: 'Abrir {client} de escritorio',
    en: 'Open {client} desktop',
  },
  sendSetupRequest: {
    es: 'Pulsa Enviar en la app: la solicitud para conectar Riverz ya está escrita.',
    en: 'Select Send in the app: the request to connect Riverz is already filled in.',
  },
  desktopFallback: {
    es: '¿La app no se abrió? Conectar desde la terminal',
    en: 'App did not open? Connect from your terminal',
  },
  desktopSetupRequest: {
    es: 'Conecta Riverz a {client} como servidor MCP con OAuth. El servidor es {url}. Configúralo para mi usuario, conserva mis otros servidores y, si Riverz ya existe con esta URL, reutilízalo. Puedes usar estos comandos:\n{commands}\nAyúdame a completar la autorización en el navegador y comprueba la conexión con el servidor. No muestres credenciales en el chat.',
    en: 'Connect Riverz to {client} as an MCP server with OAuth. The server is {url}. Configure it for my user, preserve my other servers and, if Riverz already exists with this URL, reuse it. You can use these commands:\n{commands}\nHelp me complete browser authorization and verify the server connection. Do not display credentials in the chat.',
  },
  copyAndOpenChatgpt: {
    es: 'Copiar URL y abrir ajustes de ChatGPT',
    en: 'Copy URL and open ChatGPT settings',
  },
  serverName: { es: 'Nombre', en: 'Name' },
  serverDescription: {
    es: 'Descripción: conecta tu cuenta de Riverz.',
    en: 'Description: connect your Riverz account.',
  },
  authentication: { es: 'Autenticación', en: 'Authentication' },
  urlCopied: {
    es: 'URL copiada: pégala en ChatGPT.',
    en: 'URL copied: paste it in ChatGPT.',
  },
  noCreateOption: {
    es: '¿No aparece Crear app?',
    en: 'Cannot find Create app?',
  },
  chatgptAccountRequirement: {
    es: 'Tu cuenta o espacio de ChatGPT debe permitir apps personalizadas y tener el modo desarrollador activado. También puedes conectar desde la app de escritorio.',
    en: 'Your ChatGPT account or workspace must allow custom apps and have developer mode enabled. You can also connect from the desktop app.',
  },
  useDesktop: { es: 'Usar app de escritorio', en: 'Use desktop app' },
  clientStartsLogin: {
    es: 'El inicio de sesión se abre desde tu asistente.',
    en: 'Sign-in opens from your assistant.',
  },
  runCommand: { es: 'Ejecuta en tu terminal:', en: 'Run in your terminal:' },
  copyCommand: { es: 'Copiar comandos', en: 'Copy commands' },
  copied: { es: 'Copiado', en: 'Copied' },
  copyUrl: { es: 'Copiar URL del servidor', en: 'Copy server URL' },
  copyFailed: {
    es: 'No se pudo copiar. Selecciona el texto y cópialo manualmente.',
    en: "Couldn't copy. Select the text and copy it manually.",
  },
  authorizeInBrowser: {
    es: 'Inicia sesión en Riverz en la ventana que se abre y autoriza el acceso.',
    en: 'Sign in to Riverz in the window that opens and authorize access.',
  },
  chatgptDeveloperMode: {
    es: 'Activa el modo desarrollador en ChatGPT: Ajustes → Apps → Configuración avanzada. En algunas versiones está en Seguridad e inicio de sesión.',
    en: 'Enable developer mode in ChatGPT: Settings → Apps → Advanced settings. Some versions place it under Security and login.',
  },
  openChatgpt: { es: 'Abrir ChatGPT', en: 'Open ChatGPT' },
  chatgptAddServer: {
    es: 'En Apps, pulsa Crear app. Si ves Plugins, usa + → Crear conexión. Completa estos datos:',
    en: 'In Apps, select Create app. If you see Plugins, use + → Create connection. Enter these details:',
  },
  claudeMcpFallback: {
    es: 'Si tu versión no tiene mcp login, abre Claude Code y usa /mcp → riverz → Authenticate.',
    en: 'If your version has no mcp login, open Claude Code and use /mcp → riverz → Authenticate.',
  },
  title: {
    es: '{client} quiere conectarse a tu cuenta',
    en: '{client} wants to connect to your account',
  },
  onAccount: { es: 'Cuenta: {workspace}', en: 'Account: {workspace}' },
  canRead: {
    es: 'Consultar tu operación: conversaciones, contactos, pedidos, campañas y métricas.',
    en: 'Read your operation: conversations, contacts, orders, campaigns and metrics.',
  },
  canWrite: {
    es: 'Actuar: prender automatizaciones y escribirle a tus clientes. Lo irreversible pide confirmación antes de hacerse.',
    en: 'Act: toggle automations and message your customers. Irreversible actions ask for confirmation first.',
  },
  cannotWrite: {
    es: 'No puede cambiar nada ni escribirle a nadie.',
    en: "It can't change anything or message anyone.",
  },
  revokeHint: {
    es: 'Puedes quitarle el acceso desde Ajustes → Asistentes de IA → Configuración manual.',
    en: 'You can remove access from Settings → AI assistants → Manual setup.',
  },
  allow: { es: 'Autorizar', en: 'Authorize' },
  deny: { es: 'Cancelar', en: 'Cancel' },
  failed: {
    es: 'No se pudo autorizar. Prueba de nuevo.',
    en: "Couldn't authorize. Try again.",
  },
  badRequest: {
    es: 'Este pedido de autorización está incompleto. Vuelve a intentarlo desde la aplicación que te trajo.',
    en: 'This authorization request is incomplete. Start again from the app that sent you here.',
  },
  unknownClient: {
    es: 'No reconocemos a la aplicación que pide el acceso.',
    en: "We don't recognize the app asking for access.",
  },
  noWorkspace: {
    es: 'Tu usuario todavía no tiene una cuenta de Riverz asociada.',
    en: "Your user doesn't have a Riverz account yet.",
  },
};
