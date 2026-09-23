export const DEUNA_TRACKING_REMINDER_DELAY_HOURS = 48;
export const DEUNA_TRACKING_REMINDER_AUTOMATION_ID =
  '7860c0bb-22fb-4ad4-9b7b-efba77f248b3';

export const DEUNA_TRACKING_REMINDER_TEMPLATE = {
  name: 'deuna_recordatorio_tracking_v1',
  language: 'es',
  category: 'UTILITY',
  body: `Hola, {{1}} 😊

Tu pedido sigue en camino 🚚

Ya fue preparado para ti y queremos que llegue sin contratiempos. Por favor, mantente pendiente del celular y de cualquier llamada o mensaje de la transportadora.

Si no vas a estar, deja a alguien autorizado para recibirlo. Recuerda tener listo el valor acordado para pagar al recibir.

Guía: {{2}}

¡Ya falta menos! Gracias por estar pendiente para completar la entrega con éxito 💛`,
  samples: ['Benjamín', '240061839733'],
  variableFields: {
    '1': 'recipient_name',
    '2': 'tracking_number',
  },
} as const;
