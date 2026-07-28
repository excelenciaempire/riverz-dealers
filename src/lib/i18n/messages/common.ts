import type { Namespace } from "./types";

/**
 * Shared strings used across many features — generic verbs, statuses and
 * confirmations. Keep this small and truly generic; feature-specific copy
 * belongs in that feature's namespace.
 */
export const common = {
  save: { es: "Guardar", en: "Save" },
  cancel: { es: "Cancelar", en: "Cancel" },
  delete: { es: "Eliminar", en: "Delete" },
  edit: { es: "Editar", en: "Edit" },
  close: { es: "Cerrar", en: "Close" },
  back: { es: "Volver", en: "Back" },
  next: { es: "Siguiente", en: "Next" },
  previous: { es: "Anterior", en: "Previous" },
  confirm: { es: "Confirmar", en: "Confirm" },
  search: { es: "Buscar", en: "Search" },
  loading: { es: "Cargando...", en: "Loading..." },
  saving: { es: "Guardando...", en: "Saving..." },
  saved: { es: "Guardado", en: "Saved" },
  error: { es: "Ocurrió un error", en: "Something went wrong" },
  retry: { es: "Reintentar", en: "Retry" },
  add: { es: "Añadir", en: "Add" },
  remove: { es: "Quitar", en: "Remove" },
  create: { es: "Crear", en: "Create" },
  connect: { es: "Conectar", en: "Connect" },
  disconnect: { es: "Desconectar", en: "Disconnect" },
  yes: { es: "Sí", en: "Yes" },
  no: { es: "No", en: "No" },
  optional: { es: "Opcional", en: "Optional" },
  required: { es: "Obligatorio", en: "Required" },
  // Channel labels that aren't brand names (resolved via channelLabel()).
  channelFbComments: { es: "Comentarios FB", en: "FB comments" },
  channelIgComments: { es: "Comentarios IG", en: "IG comments" },
  channelMlReviews: { es: "Opiniones ML", en: "ML reviews" },
} satisfies Namespace;
