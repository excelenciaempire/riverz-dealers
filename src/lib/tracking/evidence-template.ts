export const TRACKING_EVIDENCE_TEMPLATE = {
  name: 'deuna_estado_transportadora_foto_v1',
  language: 'es',
  category: 'UTILITY',
  headerType: 'IMAGE',
  body: `Hola, {{1}} 😊

Rastreé tu guía directamente con {{2}} y te comparto el resultado actualizado en la imagen.

Guía: {{3}}

Tu pedido sigue en camino. Por favor, mantente pendiente del celular y de cualquier llamada o mensaje de la transportadora para que puedan completar la entrega. 🤍`,
  samples: ['Efraín', 'Envía', '114015579121'],
  variableFields: { '1': 'recipient_name', '2': 'tracking_company', '3': 'tracking_number' },
} as const;
