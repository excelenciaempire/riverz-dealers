import type { Namespace } from './types';

export const voiceNotes: Namespace = {
  unsupportedChannel: { es: 'Este canal no admite notas de voz. Usa un paso de texto.', en: 'This channel does not support voice notes. Use a text step.' },
  channelAudio: { es: 'Se enviará como audio; en correo, como archivo adjunto.', en: 'Sent as audio; in email, as an attachment.' },
  supportedChannels: { es: 'WhatsApp, Instagram, Messenger, chat web y correo. Meta requiere un mensaje del cliente en las últimas 24 horas. No disponible en comentarios, Mercado Libre ni llamadas.', en: 'WhatsApp, Instagram, Messenger, web chat and email. Meta requires a customer message within the last 24 hours. Unavailable in comments, Mercado Libre or calls.' },
  samples: {
    es: 'Datos para escuchar el ejemplo',
    en: 'Sample values for preview',
  },
  saveAudio: { es: 'Guardar este audio', en: 'Save this audio' },
  contextChanged: {
    es: 'El cliente escribió de nuevo. Se canceló el audio anterior.',
    en: 'The customer sent a new message. The previous audio was cancelled.',
  },
  title: { es: 'Notas de voz', en: 'Voice notes' },
  textMode: { es: 'Texto', en: 'Text' },
  fish: { es: 'Generar con Fish', en: 'Generate with Fish' },
  saved: { es: 'Plantilla de voz', en: 'Voice template' },
  upload: { es: 'Audio pregrabado', en: 'Prerecorded audio' },
  voice: { es: 'Voz', en: 'Voice' },
  voiceId: { es: 'ID de voz de Fish', en: 'Fish voice ID' },
  queued: { es: 'Campaña de voz programada', en: 'Voice campaign scheduled' },
  rateLimit: {
    es: 'Espera un momento antes de generar otro audio.',
    en: 'Wait a moment before generating another audio.',
  },
  defaultVoice: { es: 'Voz predeterminada', en: 'Default voice' },
  script: { es: 'Texto del audio', en: 'Audio script' },
  variables: {
    es: 'Puedes usar {{name}} y {{first_name}}.',
    en: 'You can use {{name}} and {{first_name}}.',
  },
  choose: { es: 'Selecciona una plantilla', en: 'Choose a template' },
  preview: { es: 'Escuchar', en: 'Preview' },
  send: { es: 'Enviar nota de voz', en: 'Send voice note' },
  save: { es: 'Guardar plantilla de voz', en: 'Save voice template' },
  name: { es: 'Nombre', en: 'Name' },
  savedOk: { es: 'Plantilla guardada', en: 'Template saved' },
  sent: { es: 'Nota de voz enviada', en: 'Voice note sent' },
  window: {
    es: 'WhatsApp, Instagram y Messenger requieren un mensaje del cliente en las últimas 24 horas.',
    en: 'WhatsApp, Instagram and Messenger require a customer message within the last 24 hours.',
  },
  libraryHint: {
    es: 'Audios reutilizables para conversaciones abiertas. No requieren aprobación de Meta.',
    en: 'Reusable audio for open conversations. No Meta approval required.',
  },
  format: {
    es: 'MP3, M4A, WAV u OGG. Máximo 16 MB y 10 minutos.',
    en: 'MP3, M4A, WAV or Ogg. Up to 16 MB and 10 minutes.',
  },
  invalidAudio: {
    es: 'Usa un audio MP3, M4A, WAV u OGG válido, de hasta 16 MB y 10 minutos.',
    en: 'Use a valid MP3, M4A, WAV or Ogg audio file, up to 16 MB and 10 minutes.',
  },
  invalidText: {
    es: 'Escribe un texto de hasta 2000 caracteres o selecciona un audio.',
    en: 'Enter up to 2000 characters or select an audio file.',
  },
  variablesMissing: {
    es: 'Faltan datos para completar el texto del audio.',
    en: 'Some values needed for the audio script are missing.',
  },
  failed: {
    es: 'No se pudo preparar la nota de voz.',
    en: 'Could not prepare the voice note.',
  },
  templateMissing: {
    es: 'La plantilla de voz ya no está disponible.',
    en: 'This voice template is no longer available.',
  },
  notConfigured: {
    es: 'Configura Fish y selecciona una voz para generar el audio.',
    en: 'Configure Fish and select a voice to generate audio.',
  },
  budget: {
    es: 'No hay saldo disponible para generar el audio.',
    en: 'There is no available balance to generate audio.',
  },
  blocked: {
    es: 'El envío está pausado o el contacto no permite mensajes.',
    en: 'Sending is paused or the contact does not allow messages.',
  },
  conversationMissing: {
    es: 'No hay una conversación conectada disponible.',
    en: 'No connected conversation is available.',
  },
  sentNotSaved: {
    es: 'El canal aceptó el audio, pero no se pudo guardar el registro. No vuelvas a enviarlo.',
    en: 'The channel accepted the audio, but its record could not be saved. Do not resend it.',
  },
  agentHint: {
    es: 'Fish convierte las respuestas en notas de voz. Las respuestas con enlaces se envían en texto.',
    en: 'Fish turns replies into voice notes. Replies containing links are sent as text.',
  },
  replyScript: { es: 'Respuesta del agente', en: 'Agent reply' },
  campaignHint: {
    es: 'Los destinatarios bloqueados mostrarán el motivo.',
    en: 'Blocked recipients will show the reason.',
  },
};
