import type { Namespace } from "./types";

/**
 * Devoluciones y cambios, y lo que el agente no supo contestar.
 *
 * Dos listas de trabajo que nacen de la conversación y terminan en una
 * decisión de una persona. Van juntas porque comparten la forma: el agente
 * anota, alguien resuelve.
 */
export const returns = {
  title: { es: "Devoluciones", en: "Returns" },
  subtitle: {
    es: "Lo que pidieron devolver o cambiar desde una conversación.",
    en: "What people asked to return or exchange from a conversation.",
  },
  empty: { es: "No hay devoluciones abiertas.", en: "No open returns." },
  noName: { es: "Sin nombre", en: "No name" },
  kindReturn: { es: "Devolución", en: "Return" },
  kindExchange: { es: "Cambio", en: "Exchange" },
  saveFailed: { es: "No se pudo guardar.", en: "Could not save." },
  "status.abierta": { es: "Espera decisión", en: "Awaiting decision" },
  "status.aprobada": { es: "Aprobada", en: "Approved" },
  "status.rechazada": { es: "Rechazada", en: "Declined" },
  "status.recibida": { es: "Producto recibido", en: "Item received" },
  "status.resuelta": { es: "Resuelta", en: "Resolved" },
  "action.aprobada": { es: "Aprobar", en: "Approve" },
  "action.rechazada": { es: "Rechazar", en: "Decline" },
  "action.recibida": { es: "Marcar recibido", en: "Mark received" },
  "action.resuelta": { es: "Cerrar", en: "Close" },
} satisfies Namespace;

export const gaps = {
  title: { es: "Lo que no supo contestar", en: "What it could not answer" },
  hint: {
    es: "Las preguntas donde el agente reconoció que le faltaba el dato. Cargá la respuesta en su conocimiento y dejan de aparecer.",
    en: "Questions where the agent admitted it was missing the fact. Add the answer to its knowledge and they stop showing up.",
  },
  empty: { es: "No quedó ninguna sin contestar.", en: "Nothing went unanswered." },
  times: { es: "Preguntada {n} veces", en: "Asked {n} times" },
  markDone: { es: "Ya la cargué", en: "Added" },
  answer: { es: "Responder", en: "Answer" },
  pickProduct: { es: "¿De qué producto es?", en: "Which product is it about?" },
  answerPlaceholder: {
    es: "La respuesta, como se la darías a un cliente.",
    en: "The answer, the way you would give it to a customer.",
  },
  saveAnswer: { es: "Guardar en el producto", en: "Save to the product" },
  answered: {
    es: "Listo. El agente ya sabe contestarla.",
    en: "Done. The agent can answer it now.",
  },
  saveFailed: { es: "No se pudo guardar.", en: "Could not save." },
} satisfies Namespace;
