import type { Namespace } from "./types";

/**
 * La pantalla donde una persona le da acceso a su cuenta a un programa.
 *
 * Es la única de todo el flujo de OAuth que se ve, así que dice qué se está
 * concediendo en vez de pedir un "autorizar" a ciegas. La diferencia entre leer
 * y escribir está separada a propósito: una consulta y un mensaje que le llega
 * a un cliente real no son lo mismo.
 */
export const oauth: Namespace = {
  title: { es: "{client} quiere conectarse a tu cuenta", en: "{client} wants to connect to your account" },
  onAccount: { es: "Cuenta: {workspace}", en: "Account: {workspace}" },
  canRead: {
    es: "Consultar tu operación: conversaciones, contactos, pedidos, campañas y métricas.",
    en: "Read your operation: conversations, contacts, orders, campaigns and metrics.",
  },
  canWrite: {
    es: "Actuar: prender automatizaciones y escribirle a tus clientes. Lo irreversible pide confirmación antes de hacerse.",
    en: "Act: toggle automations and message your customers. Irreversible actions ask for confirmation first.",
  },
  cannotWrite: {
    es: "No puede cambiar nada ni escribirle a nadie.",
    en: "It can't change anything or message anyone.",
  },
  revokeHint: {
    es: "Podés cortarle el acceso cuando quieras desde Ajustes → Agentes (MCP).",
    en: "You can cut off access any time from Settings → Agents (MCP).",
  },
  allow: { es: "Autorizar", en: "Authorize" },
  deny: { es: "Cancelar", en: "Cancel" },
  failed: { es: "No se pudo autorizar. Probá de nuevo.", en: "Couldn't authorize. Try again." },
  badRequest: {
    es: "Este pedido de autorización está incompleto. Volvé a intentarlo desde la aplicación que te trajo.",
    en: "This authorization request is incomplete. Start again from the app that sent you here.",
  },
  unknownClient: {
    es: "No reconocemos a la aplicación que pide el acceso.",
    en: "We don't recognize the app asking for access.",
  },
  noWorkspace: {
    es: "Tu usuario todavía no tiene una cuenta de Riverz asociada.",
    en: "Your user doesn't have a Riverz account yet.",
  },
};
