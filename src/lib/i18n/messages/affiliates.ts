import type { Namespace } from './types';

export const affiliates = {
  approvalSubject: {
    es: 'Tu afiliación de Riverz fue aprobada',
    en: 'Your Riverz affiliate application was approved',
  },
  approvalBody: {
    es: 'Ya puedes compartir tu enlace personal. Recibes el 35% recurrente de las suscripciones atribuidas a tu enlace mientras sigan activas.',
    en: 'You can now share your personal link. Earn a recurring 35% on subscriptions attributed to your link for as long as they remain active.',
  },
  approvalTerms: {
    es: 'La atribución dura 30 días. Las comisiones se validan durante 30 días antes de quedar disponibles para pago.',
    en: 'Attribution lasts 30 days. Commissions are validated for 30 days before becoming payable.',
  },
  adminCommissionBase: { es: '{rate}% de {amount}', en: '{rate}% of {amount}' },
  adminClawback: {
    es: 'A recuperar por reembolso: {amount}',
    en: 'Recover after refund: {amount}',
  },
  metaTitle: {
    es: 'Programa de afiliados — gana 35% recurrente',
    en: 'Affiliate program — earn 35% recurring',
  },
  metaDescription: {
    es: 'Recomienda Riverz y recibe el 35% de cada mensualidad pagada por tus referidos, mientras sigan siendo clientes.',
    en: 'Recommend Riverz and receive 35% of every subscription payment from your referrals, for as long as they remain customers.',
  },
  navHome: { es: 'Inicio', en: 'Home' },
  navApply: { es: 'Quiero ser afiliado', en: 'Become an affiliate' },
  eyebrow: { es: 'Programa de afiliados', en: 'Affiliate program' },
  heroTitle: { es: 'Recomienda Riverz.', en: 'Recommend Riverz.' },
  heroTitleAccent: { es: 'Cobra cada mes.', en: 'Get paid every month.' },
  heroBody: {
    es: 'Recibe el 35% de cada mensualidad pagada por los clientes que refieras. No es un bono de una sola vez: la comisión se repite mientras la cuenta siga activa.',
    en: 'Receive 35% of every subscription payment made by customers you refer. It is not a one-time bonus: the commission repeats while the account remains active.',
  },
  heroCta: { es: 'Solicitar acceso', en: 'Apply now' },
  heroSecondary: { es: 'Ver cómo funciona', en: 'See how it works' },
  recurringLabel: { es: 'Comisión recurrente', en: 'Recurring commission' },
  recurringValue: { es: '35%', en: '35%' },
  recurringNote: {
    es: 'Cada mensualidad pagada',
    en: 'Every paid subscription month',
  },
  calculatorEyebrow: { es: 'Calculadora', en: 'Calculator' },
  calculatorTitle: {
    es: 'Tu recomendación sigue pagando.',
    en: 'Your recommendation keeps paying.',
  },
  calculatorBody: {
    es: 'Una estimación simple, antes de impuestos, descuentos o reembolsos.',
    en: 'A simple estimate before taxes, discounts, or refunds.',
  },
  calculatorReferrals: {
    es: 'Clientes activos referidos',
    en: 'Active referred customers',
  },
  calculatorPlan: {
    es: 'Mensualidad promedio',
    en: 'Average monthly subscription',
  },
  calculatorMonthly: {
    es: 'Comisión mensual estimada',
    en: 'Estimated monthly commission',
  },
  calculatorYearly: {
    es: 'Al año, si siguen activos',
    en: 'Per year, if they stay active',
  },
  howEyebrow: { es: 'Cómo funciona', en: 'How it works' },
  howTitle: {
    es: 'Un enlace. Comisiones recurrentes.',
    en: 'One link. Recurring commissions.',
  },
  stepOneTitle: { es: 'Solicita acceso', en: 'Apply' },
  stepOneBody: {
    es: 'Cuéntanos quién es tu audiencia y cómo presentarías Riverz.',
    en: 'Tell us about your audience and how you would introduce Riverz.',
  },
  stepTwoTitle: { es: 'Comparte tu enlace', en: 'Share your link' },
  stepTwoBody: {
    es: 'Al aprobarte, recibes un enlace único con atribución durante 30 días.',
    en: 'Once approved, you receive a unique link with 30-day attribution.',
  },
  stepThreeTitle: { es: 'Cobra cada mes', en: 'Earn every month' },
  stepThreeBody: {
    es: 'Cuando el referido paga su mensualidad, se registra tu 35% automáticamente.',
    en: 'When your referral pays their subscription, your 35% is recorded automatically.',
  },
  includedTitle: { es: 'Lo que incluye', en: 'What you get' },
  includedOne: {
    es: '35% de comisión recurrente',
    en: '35% recurring commission',
  },
  includedTwo: {
    es: 'Enlace personal con atribución de 30 días',
    en: 'Personal link with 30-day attribution',
  },
  includedThree: {
    es: 'Registro de cada factura pagada',
    en: 'Tracking for every paid invoice',
  },
  includedFour: {
    es: 'Pago mensual después del período de validación',
    en: 'Monthly payout after the validation period',
  },
  clarityTitle: {
    es: 'Reglas claras desde el inicio.',
    en: 'Clear rules from day one.',
  },
  clarityBody: {
    es: 'La comisión se calcula sobre la mensualidad efectivamente cobrada, sin impuestos, descuentos, devoluciones ni cargos extraordinarios. Se valida durante 30 días antes de quedar disponible para pago.',
    en: 'Commission is calculated on the subscription amount actually collected, excluding taxes, discounts, refunds, and one-time charges. It is validated for 30 days before becoming payable.',
  },
  applyEyebrow: { es: 'Solicitud', en: 'Application' },
  applyTitle: {
    es: 'Conviértete en afiliado de Riverz.',
    en: 'Become a Riverz affiliate.',
  },
  applyBody: {
    es: 'Revisamos cada solicitud para cuidar la marca y la experiencia del cliente.',
    en: 'We review every application to protect the brand and customer experience.',
  },
  nameLabel: { es: 'Nombre completo', en: 'Full name' },
  emailLabel: { es: 'Correo', en: 'Email' },
  websiteLabel: { es: 'Sitio o perfil principal', en: 'Main site or profile' },
  websiteOptional: { es: 'Opcional', en: 'Optional' },
  audienceLabel: { es: 'Tu audiencia', en: 'Your audience' },
  audiencePlaceholder: {
    es: 'Ej. dueños de tiendas en línea',
    en: 'E.g. online store owners',
  },
  planLabel: {
    es: '¿Cómo recomendarías Riverz?',
    en: 'How would you promote Riverz?',
  },
  planPlaceholder: {
    es: 'Canal, tipo de contenido y contexto',
    en: 'Channel, content format, and context',
  },
  payoutLabel: { es: 'Correo para pagos', en: 'Payout email' },
  payoutHint: {
    es: 'Puede ser el mismo correo de contacto.',
    en: 'This can be the same as your contact email.',
  },
  submit: { es: 'Enviar solicitud', en: 'Submit application' },
  submitting: { es: 'Enviando…', en: 'Submitting…' },
  successTitle: { es: 'Solicitud recibida.', en: 'Application received.' },
  successBody: {
    es: 'Te escribiremos al correo indicado después de revisarla.',
    en: 'We will email you after reviewing it.',
  },
  formError: {
    es: 'No pudimos enviar la solicitud. Intenta de nuevo.',
    en: 'We could not submit your application. Please try again.',
  },
  formInvalid: {
    es: 'Revisa los campos e intenta de nuevo.',
    en: 'Check the fields and try again.',
  },
  referralUnavailable: {
    es: 'Este enlace de afiliado ya no está disponible.',
    en: 'This affiliate link is no longer available.',
  },
  faqTitle: { es: 'Preguntas frecuentes', en: 'Frequently asked questions' },
  faqOneQ: {
    es: '¿El 35% se paga una sola vez?',
    en: 'Is the 35% paid only once?',
  },
  faqOneA: {
    es: 'No. Se registra en cada mensualidad pagada mientras el cliente referido mantenga una suscripción activa.',
    en: 'No. It is recorded on every paid subscription month while the referred customer keeps an active subscription.',
  },
  faqTwoQ: {
    es: '¿Qué cuenta como referido?',
    en: 'What counts as a referral?',
  },
  faqTwoA: {
    es: 'Una cuenta nueva que llega por tu enlace, se registra dentro de 30 días y luego paga una suscripción de Riverz.',
    en: 'A new account that arrives through your link, signs up within 30 days, and later pays for a Riverz subscription.',
  },
  faqThreeQ: {
    es: '¿Cuándo se paga la comisión?',
    en: 'When is commission paid?',
  },
  faqThreeA: {
    es: 'Las comisiones se validan durante 30 días y después se incluyen en el siguiente pago mensual.',
    en: 'Commissions are validated for 30 days and then included in the next monthly payout.',
  },
  faqFourQ: { es: '¿Puedo usar anuncios pagados?', en: 'Can I use paid ads?' },
  faqFourA: {
    es: 'Sí, después de acordar el canal con Riverz. No se permite pujar por la marca Riverz ni presentarse como cuenta oficial.',
    en: 'Yes, after agreeing on the channel with Riverz. Bidding on the Riverz brand or presenting yourself as an official account is not allowed.',
  },
  footerProgram: { es: 'Afiliados', en: 'Affiliates' },
  adminTitle: { es: 'Afiliados', en: 'Affiliates' },
  adminDescription: {
    es: 'Solicitudes, referidos, comisiones y pagos.',
    en: 'Applications, referrals, commissions, and payouts.',
  },
  adminPending: { es: 'Pendiente', en: 'Pending' },
  adminActive: { es: 'Activo', en: 'Active' },
  adminRejected: { es: 'Rechazado', en: 'Rejected' },
  adminPaused: { es: 'Pausado', en: 'Paused' },
  adminApprove: { es: 'Aprobar', en: 'Approve' },
  adminReject: { es: 'Rechazar', en: 'Reject' },
  adminPause: { es: 'Pausar', en: 'Pause' },
  adminPay: { es: 'Marcar pagada', en: 'Mark paid' },
  adminApplications: { es: 'Solicitudes', en: 'Applications' },
  adminCommissions: { es: 'Comisiones', en: 'Commissions' },
  adminReferrals: { es: 'Referidos', en: 'Referrals' },
  adminCode: { es: 'Enlace', en: 'Link' },
  adminNoRows: { es: 'Todavía no hay datos.', en: 'No data yet.' },
  adminAvailable: { es: 'Disponible', en: 'Available' },
  adminOnHold: { es: 'En validación', en: 'On hold' },
  adminPaid: { es: 'Pagada', en: 'Paid' },
  adminReversed: { es: 'Revertida', en: 'Reversed' },
  adminSaveError: {
    es: 'No se pudo guardar el cambio.',
    en: 'Could not save the change.',
  },
} satisfies Namespace;
