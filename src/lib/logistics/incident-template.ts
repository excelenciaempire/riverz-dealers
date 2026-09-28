export const DELIVERY_INCIDENT_TEMPLATES = [
  {
    name: 'deuna_novedad_entrega_v1',
    language: 'es',
    category: 'UTILITY',
    body: `Hola, {{1}}. La transportadora reportó una novedad con la entrega de:

{{2}}

Motivo: {{3}}
Guía: {{4}}
Seguimiento: {{5}}

Para ayudarte a completar la entrega, confirma si los datos siguen correctos o indícanos qué debemos corregir.`,
    samples: [
      'Ana',
      '1 × Pelota saltarina LED (Rana Verde)',
      'La transportadora necesita confirmar información de entrega.',
      '024034940186',
      'https://hub.envia.co/landingrastreo/Rastreo/Index?guia=024034940186',
    ],
    buttons: [
      { type: 'QUICK_REPLY' as const, text: 'DATOS CORRECTOS' },
      { type: 'QUICK_REPLY' as const, text: 'CORREGIR DATOS' },
    ],
  },
  {
    name: 'deuna_novedad_entrega_v1',
    language: 'en',
    category: 'UTILITY',
    body: `Hi, {{1}}. The carrier reported an issue with the delivery of:

{{2}}

Reason: {{3}}
Tracking number: {{4}}
Track it here: {{5}}

To help complete the delivery, confirm whether your details are still correct or tell us what needs changing.`,
    samples: [
      'Ana',
      '1 × LED bouncing ball (Green Frog)',
      'The carrier needs to confirm the delivery details.',
      '024034940186',
      'https://hub.envia.co/landingrastreo/Rastreo/Index?guia=024034940186',
    ],
    buttons: [
      { type: 'QUICK_REPLY' as const, text: 'DETAILS ARE CORRECT' },
      { type: 'QUICK_REPLY' as const, text: 'CORRECT DETAILS' },
    ],
  },
] as const;

export const DELIVERY_INCIDENT_VARIABLE_FIELDS = {
  '1': 'recipient_name',
  '2': 'order_items',
  '3': 'incident_reason',
  '4': 'tracking_number',
  '5': 'tracking_url',
} as const;
