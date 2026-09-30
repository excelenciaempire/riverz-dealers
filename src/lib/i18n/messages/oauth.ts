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
  connectTitle: { es: 'Conectar con OAuth', en: 'Connect with OAuth' },
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
  chooseOpenaiClient: {
    es: 'Conectar desde',
    en: 'Connect from',
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
    es: 'Puedes cortarle el acceso cuando quieras desde Ajustes → Agentes (MCP).',
    en: 'You can cut off access any time from Settings → Agents (MCP).',
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
