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

export const unify = {
  title: { es: "Productos repetidos entre plataformas", en: "Products duplicated across platforms" },
  hint: {
    es: "El mismo producto vive una vez por canal. Unificalos y el conocimiento se carga una sola vez.",
    en: "The same product lives once per channel. Merge them and the knowledge is written once.",
  },
  bySku: { es: "Tienen el mismo SKU", en: "Same SKU" },
  byTitle: { es: "El nombre coincide", en: "Matching name" },
  pricesKept: {
    es: "Cada canal conserva su precio y su enlace. Sólo se unifica lo que el agente sabe.",
    en: "Each channel keeps its own price and link. Only what the agent knows is merged.",
  },
  merge: { es: "Es el mismo producto", en: "Same product" },
  notSame: { es: "No son el mismo", en: "Not the same" },
  selected: { es: "{n} elegidos", en: "{n} selected" },
  cancel: { es: "Cancelar", en: "Cancel" },
  separate: { es: "Separar", en: "Unlink" },
  channels: { es: "También se vende en", en: "Also sold on" },
  separated: { es: "Listo, vuelve a ser un producto aparte.", en: "Done, it is a separate product again." },
  done: { es: "Listo. El agente ya contesta igual por todos los canales.", en: "Done. The agent now answers the same on every channel." },
  failed: { es: "No se pudo unificar.", en: "Could not merge." },
} satisfies Namespace;

export const approvals = {
  title: { es: "Esperando tu sí", en: "Waiting on you" },
  subtitle: {
    es: "Lo que el agente preparó y no hace hasta que decidas.",
    en: "What the agent prepared and will not do until you decide.",
  },
  empty: { es: "No hay nada esperando.", en: "Nothing waiting." },
  approve: { es: "Aprobar", en: "Approve" },
  reject: { es: "Rechazar", en: "Decline" },
  done: { es: "Listo.", en: "Done." },
  failed: { es: "No se pudo.", en: "Could not do it." },
} satisfies Namespace;
