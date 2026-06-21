import type { Namespace } from "./types";

/**
 * Standalone legal/content pages: privacy policy, terms & conditions and
 * the data-deletion page. One key per heading / paragraph / list item.
 * Translate faithfully — these are legal documents.
 */
export const legal = {
  // Shared brand eyebrow + meta
  brand: { es: "riverz", en: "riverz" },
  updatedLabel: {
    es: "Última actualización: {date}",
    en: "Last updated: {date}",
  },

  // Shared footer links
  footerPrivacy: { es: "Política de privacidad", en: "Privacy policy" },
  footerTerms: { es: "Términos y condiciones", en: "Terms and conditions" },
  footerDeleteData: { es: "Eliminar mis datos", en: "Delete my data" },
  footerSite: { es: "riverz.co", en: "riverz.co" },

  // ── Privacy policy ───────────────────────────────────────────────────────
  privacyMetaTitle: { es: "Política de privacidad", en: "Privacy policy" },
  privacyMetaDescription: {
    es: "Cómo riverz recopila, usa y protege tus datos.",
    en: "How riverz collects, uses and protects your data.",
  },
  privacyTitle: { es: "Política de privacidad", en: "Privacy policy" },

  privacy1Title: { es: "1. Quiénes somos", en: "1. Who we are" },
  privacy1BodyPre: {
    es: "riverz es una plataforma de atención y CRM omnicanal que permite a comercios y empresas centralizar y responder, desde una sola bandeja, las conversaciones de sus clientes en WhatsApp, Instagram, Messenger y correo electrónico. El servicio se presta a través de ",
    en: "riverz is an omnichannel support and CRM platform that lets merchants and companies centralize and respond, from a single inbox, to their customers' conversations on WhatsApp, Instagram, Messenger and email. The service is provided through ",
  },
  privacy1BodyMid: {
    es: ". Para cualquier consulta sobre privacidad escríbenos a ",
    en: ". For any privacy-related questions, write to us at ",
  },
  privacy1BodyEnd: { es: ".", en: "." },

  privacy2Title: { es: "2. Qué datos tratamos", en: "2. What data we process" },
  privacy2Intro: {
    es: "Tratamos dos tipos de información:",
    en: "We process two types of information:",
  },
  privacy2Item1Strong: {
    es: "Datos del comercio (nuestro cliente):",
    en: "Merchant data (our customer):",
  },
  privacy2Item1Rest: {
    es: " nombre, correo, datos de la cuenta y de la empresa, y los tokens de acceso de las cuentas que conecta (WhatsApp, Páginas de Facebook, cuentas de Instagram, Shopify, correo). Los tokens se guardan cifrados.",
    en: " name, email, account and company details, and the access tokens of the accounts they connect (WhatsApp, Facebook Pages, Instagram accounts, Shopify, email). Tokens are stored encrypted.",
  },
  privacy2Item2Strong: {
    es: "Datos de los clientes finales del comercio:",
    en: "Data of the merchant's end customers:",
  },
  privacy2Item2Rest: {
    es: " cuando un comercio conecta sus cuentas, procesamos en su nombre los mensajes, comentarios, nombre de perfil público, identificadores de usuario y metadatos de las conversaciones que esas personas le envían, para mostrarlos en la bandeja y permitir responderlos.",
    en: " when a merchant connects their accounts, we process on their behalf the messages, comments, public profile name, user identifiers and conversation metadata that those people send them, in order to display them in the inbox and allow replies.",
  },

  privacy3Title: {
    es: "3. Para qué usamos los datos",
    en: "3. What we use the data for",
  },
  privacy3Body: {
    es: "Usamos los datos únicamente para prestar el servicio: recibir y mostrar mensajes y comentarios, permitir que el comercio responda, ofrecer respuestas asistidas por IA cuando el comercio lo activa, generar estadísticas de atención y mantener la seguridad del sistema. No vendemos datos personales ni los usamos para publicidad de terceros.",
    en: "We use the data solely to provide the service: receive and display messages and comments, allow the merchant to respond, offer AI-assisted replies when the merchant enables them, generate support statistics and maintain system security. We do not sell personal data nor use it for third-party advertising.",
  },

  privacy4Title: { es: "4. Plataformas de Meta", en: "4. Meta platforms" },
  privacy4BodyPre: {
    es: "riverz utiliza las APIs de Meta (WhatsApp Business, Messenger Platform e Instagram). Cuando un comercio conecta su Página de Facebook o su cuenta de Instagram, accedemos a sus mensajes y comentarios ",
    en: "riverz uses Meta's APIs (WhatsApp Business, Messenger Platform and Instagram). When a merchant connects their Facebook Page or Instagram account, we access their messages and comments ",
  },
  privacy4BodyStrong: { es: "solo", en: "only" },
  privacy4BodyEnd: {
    es: " en las cuentas que él mismo autoriza, y exclusivamente para que pueda gestionarlos desde riverz. El uso de la información obtenida de Meta cumple con las Políticas de la Plataforma de Meta. No accedemos a cuentas de terceros que el comercio no haya conectado.",
    en: " on the accounts they themselves authorize, and exclusively so they can manage them from riverz. Our use of information obtained from Meta complies with the Meta Platform Policies. We do not access third-party accounts that the merchant has not connected.",
  },

  privacy5Title: {
    es: "5. Con quién compartimos datos (subencargados)",
    en: "5. Who we share data with (subprocessors)",
  },
  privacy5Intro: {
    es: "Nos apoyamos en proveedores que tratan datos por cuenta nuestra, bajo contrato y solo para operar el servicio:",
    en: "We rely on providers that process data on our behalf, under contract and only to operate the service:",
  },
  privacy5ItemMeta: {
    es: "Meta Platforms (APIs de WhatsApp, Messenger e Instagram).",
    en: "Meta Platforms (WhatsApp, Messenger and Instagram APIs).",
  },
  privacy5ItemSupabase: {
    es: "Supabase (base de datos y almacenamiento).",
    en: "Supabase (database and storage).",
  },
  privacy5ItemRender: {
    es: "Render (alojamiento de la aplicación).",
    en: "Render (application hosting).",
  },
  privacy5ItemAnthropic: {
    es: "Anthropic (modelos de IA, solo cuando el comercio activa el asistente).",
    en: "Anthropic (AI models, only when the merchant enables the assistant).",
  },
  privacy5ItemShopify: {
    es: "Shopify (cuando el comercio conecta su tienda).",
    en: "Shopify (when the merchant connects their store).",
  },

  privacy6Title: { es: "6. Conservación", en: "6. Retention" },
  privacy6Body: {
    es: "Conservamos los datos mientras la cuenta del comercio esté activa y sean necesarios para prestar el servicio. Cuando una cuenta se elimina, o cuando se recibe una solicitud de eliminación válida, borramos o anonimizamos los datos asociados en un plazo razonable.",
    en: "We retain data for as long as the merchant's account is active and the data is necessary to provide the service. When an account is deleted, or when a valid deletion request is received, we erase or anonymize the associated data within a reasonable period.",
  },

  privacy7Title: {
    es: "7. Tus derechos y eliminación de datos",
    en: "7. Your rights and data deletion",
  },
  privacy7Body1: {
    es: "Puedes solicitar acceso, corrección o eliminación de tus datos. Si eres un usuario que interactuó con un comercio que usa riverz, puedes pedir la eliminación de tus datos en cualquier momento.",
    en: "You can request access to, correction of, or deletion of your data. If you are a user who interacted with a merchant that uses riverz, you can request the deletion of your data at any time.",
  },
  privacy7Body2Pre: { es: "Consulta cómo en ", en: "Learn how at " },
  privacy7Body2End: {
    es: ". Las solicitudes automáticas de Meta (al eliminar la app) se procesan a través de nuestro callback de eliminación de datos.",
    en: ". Automatic requests from Meta (when the app is removed) are processed through our data deletion callback.",
  },

  privacy8Title: { es: "8. Seguridad", en: "8. Security" },
  privacy8Body: {
    es: "Ciframos los tokens de acceso, verificamos la firma de los webhooks entrantes y aplicamos control de acceso por cuenta. Aun así, ningún sistema es 100% infalible; trabajamos para proteger tu información de forma continua.",
    en: "We encrypt access tokens, verify the signature of incoming webhooks and apply per-account access control. Even so, no system is 100% foolproof; we work to protect your information continuously.",
  },

  privacy9Title: { es: "9. Cambios", en: "9. Changes" },
  privacy9Body: {
    es: "Podemos actualizar esta política. Publicaremos los cambios en esta página con su fecha de actualización.",
    en: "We may update this policy. We will publish any changes on this page along with their update date.",
  },

  privacy10Title: { es: "10. Contacto", en: "10. Contact" },
  privacy10BodyPre: { es: "¿Preguntas? Escríbenos a ", en: "Questions? Write to us at " },
  privacy10BodyEnd: { es: ".", en: "." },

  // ── Terms & conditions ───────────────────────────────────────────────────
  termsMetaTitle: { es: "Términos y condiciones", en: "Terms and conditions" },
  termsMetaDescription: {
    es: "Condiciones de uso del servicio riverz.",
    en: "Conditions of use of the riverz service.",
  },
  termsTitle: { es: "Términos y condiciones", en: "Terms and conditions" },

  termsDisclaimer: {
    es: "Documento base pendiente de revisión legal. Las condiciones definitivas pueden variar.",
    en: "Draft document pending legal review. The final conditions may vary.",
  },

  terms1Title: {
    es: "1. Aceptación de los términos",
    en: "1. Acceptance of the terms",
  },
  terms1BodyPre: {
    es: "Estos términos y condiciones (los «Términos») regulan el acceso y uso de la plataforma riverz (el «Servicio»), disponible en ",
    en: "These terms and conditions (the «Terms») govern access to and use of the riverz platform (the «Service»), available at ",
  },
  terms1BodyMid: {
    es: ". Al crear una cuenta o usar el Servicio, aceptas estos Términos y nuestra ",
    en: ". By creating an account or using the Service, you accept these Terms and our ",
  },
  terms1BodyEnd: {
    es: ". Si no estás de acuerdo, no debes usar el Servicio.",
    en: ". If you do not agree, you must not use the Service.",
  },

  terms2Title: {
    es: "2. Descripción del servicio",
    en: "2. Description of the service",
  },
  terms2Body: {
    es: "riverz es una plataforma de atención y CRM omnicanal que permite a comercios y empresas centralizar, automatizar y responder, desde una sola bandeja, las conversaciones de sus clientes en WhatsApp, Instagram, Messenger y correo electrónico, así como gestionar campañas, productos y respuestas asistidas por IA. Podemos modificar, ampliar o suspender funciones del Servicio en cualquier momento.",
    en: "riverz is an omnichannel support and CRM platform that lets merchants and companies centralize, automate and respond, from a single inbox, to their customers' conversations on WhatsApp, Instagram, Messenger and email, as well as manage campaigns, products and AI-assisted replies. We may modify, expand or suspend features of the Service at any time.",
  },

  terms3Title: {
    es: "3. Cuentas y elegibilidad",
    en: "3. Accounts and eligibility",
  },
  terms3Body: {
    es: "Para usar el Servicio debes crear una cuenta con información veraz y mantenerla actualizada. Eres responsable de la confidencialidad de tus credenciales y de toda la actividad que ocurra bajo tu cuenta. Debes ser mayor de edad y tener capacidad legal para contratar, y usar el Servicio en nombre de una empresa o actividad comercial legítima.",
    en: "To use the Service you must create an account with truthful information and keep it up to date. You are responsible for the confidentiality of your credentials and for all activity that occurs under your account. You must be of legal age and have the legal capacity to contract, and use the Service on behalf of a legitimate company or commercial activity.",
  },

  terms4Title: { es: "4. Uso aceptable", en: "4. Acceptable use" },
  terms4Intro: {
    es: "Al usar el Servicio te comprometes a no:",
    en: "By using the Service you agree not to:",
  },
  terms4Item1: {
    es: "Enviar spam, mensajes no solicitados o contenido que infrinja las políticas de WhatsApp, Meta u otros canales conectados.",
    en: "Send spam, unsolicited messages or content that infringes the policies of WhatsApp, Meta or other connected channels.",
  },
  terms4Item2: {
    es: "Usar el Servicio para fines ilegales, fraudulentos o que vulneren derechos de terceros.",
    en: "Use the Service for illegal or fraudulent purposes or in ways that violate the rights of third parties.",
  },
  terms4Item3: {
    es: "Intentar acceder sin autorización a sistemas, datos o cuentas que no te pertenezcan.",
    en: "Attempt to gain unauthorized access to systems, data or accounts that do not belong to you.",
  },
  terms4Item4: {
    es: "Sobrecargar, interferir o comprometer la seguridad o el funcionamiento del Servicio.",
    en: "Overload, interfere with or compromise the security or operation of the Service.",
  },
  terms4Footer: {
    es: "Eres el único responsable del contenido que envías y de obtener el consentimiento necesario de los destinatarios de tus mensajes.",
    en: "You are solely responsible for the content you send and for obtaining the necessary consent from the recipients of your messages.",
  },

  terms5Title: {
    es: "5. Canales y servicios de terceros",
    en: "5. Third-party channels and services",
  },
  terms5Body: {
    es: "El Servicio se integra con plataformas de terceros (Meta/WhatsApp, Instagram, Messenger, Shopify, proveedores de correo y modelos de IA). El uso de esas integraciones está sujeto a los términos y políticas de cada proveedor. No somos responsables de cambios, interrupciones o decisiones de esas plataformas que afecten el Servicio.",
    en: "The Service integrates with third-party platforms (Meta/WhatsApp, Instagram, Messenger, Shopify, email providers and AI models). Use of those integrations is subject to the terms and policies of each provider. We are not responsible for changes, interruptions or decisions by those platforms that affect the Service.",
  },

  terms6Title: {
    es: "6. Planes, pagos y facturación",
    en: "6. Plans, payments and billing",
  },
  terms6Body: {
    es: "Algunas funciones del Servicio pueden requerir un plan de pago. Los precios, ciclos de facturación y condiciones aplicables se informan al momento de la contratación. Salvo que la ley exija lo contrario, los pagos no son reembolsables. Podemos actualizar los precios notificándolo con antelación razonable.",
    en: "Some features of the Service may require a paid plan. Prices, billing cycles and applicable conditions are disclosed at the time of purchase. Unless the law requires otherwise, payments are non-refundable. We may update prices by giving reasonable advance notice.",
  },

  terms7Title: {
    es: "7. Propiedad intelectual",
    en: "7. Intellectual property",
  },
  terms7Body: {
    es: "El Servicio, su software, marca y contenido son propiedad de riverz o de sus licenciantes. Te otorgamos una licencia limitada, no exclusiva e intransferible para usar el Servicio conforme a estos Términos. Tú conservas la titularidad de los datos y contenidos que cargas o gestionas a través del Servicio.",
    en: "The Service, its software, brand and content are the property of riverz or its licensors. We grant you a limited, non-exclusive and non-transferable license to use the Service in accordance with these Terms. You retain ownership of the data and content you upload or manage through the Service.",
  },

  terms8Title: { es: "8. Datos y privacidad", en: "8. Data and privacy" },
  terms8BodyPre: {
    es: "El tratamiento de los datos personales se rige por nuestra ",
    en: "The processing of personal data is governed by our ",
  },
  terms8BodyEnd: {
    es: ". Cuando conectas tus cuentas, procesamos datos en tu nombre y bajo tus instrucciones únicamente para prestar el Servicio.",
    en: ". When you connect your accounts, we process data on your behalf and under your instructions solely to provide the Service.",
  },

  terms9Title: {
    es: "9. Disponibilidad y garantías",
    en: "9. Availability and warranties",
  },
  terms9Body: {
    es: "Trabajamos para mantener el Servicio disponible y seguro, pero se ofrece «tal cual» y «según disponibilidad», sin garantías de funcionamiento ininterrumpido o libre de errores. En la medida permitida por la ley, no garantizamos resultados comerciales específicos derivados del uso del Servicio.",
    en: "We work to keep the Service available and secure, but it is provided «as is» and «as available», without warranties of uninterrupted or error-free operation. To the extent permitted by law, we do not guarantee any specific commercial results arising from use of the Service.",
  },

  terms10Title: {
    es: "10. Limitación de responsabilidad",
    en: "10. Limitation of liability",
  },
  terms10Body: {
    es: "En la medida máxima permitida por la ley, riverz no será responsable por daños indirectos, incidentales o lucro cesante derivados del uso o de la imposibilidad de usar el Servicio. Nuestra responsabilidad total se limitará al monto pagado por el Servicio en los doce (12) meses anteriores al hecho que origine el reclamo.",
    en: "To the maximum extent permitted by law, riverz shall not be liable for indirect or incidental damages or lost profits arising from the use of, or inability to use, the Service. Our total liability shall be limited to the amount paid for the Service in the twelve (12) months prior to the event giving rise to the claim.",
  },

  terms11Title: {
    es: "11. Suspensión y terminación",
    en: "11. Suspension and termination",
  },
  terms11Body: {
    es: "Puedes dejar de usar el Servicio y cerrar tu cuenta en cualquier momento. Podemos suspender o cancelar tu acceso si incumples estos Términos o si tu uso compromete la seguridad o el cumplimiento legal del Servicio. Tras la terminación, eliminaremos o anonimizaremos tus datos conforme a la Política de privacidad.",
    en: "You may stop using the Service and close your account at any time. We may suspend or cancel your access if you breach these Terms or if your use compromises the security or legal compliance of the Service. Following termination, we will delete or anonymize your data in accordance with the Privacy Policy.",
  },

  terms12Title: {
    es: "12. Cambios en los términos",
    en: "12. Changes to the terms",
  },
  terms12Body: {
    es: "Podemos actualizar estos Términos. Publicaremos la versión vigente en esta página con su fecha de actualización. El uso continuado del Servicio tras los cambios implica su aceptación.",
    en: "We may update these Terms. We will publish the current version on this page along with its update date. Continued use of the Service after the changes implies acceptance of them.",
  },

  terms13Title: { es: "13. Ley aplicable", en: "13. Governing law" },
  terms13Body: {
    es: "Estos Términos se rigen por la legislación aplicable en la jurisdicción donde opera riverz. Cualquier controversia se someterá a los tribunales competentes de dicha jurisdicción, sin perjuicio de los derechos que la ley reconozca como irrenunciables.",
    en: "These Terms are governed by the laws applicable in the jurisdiction where riverz operates. Any dispute shall be submitted to the competent courts of that jurisdiction, without prejudice to any rights that the law recognizes as non-waivable.",
  },

  terms14Title: { es: "14. Contacto", en: "14. Contact" },
  terms14BodyPre: {
    es: "¿Preguntas sobre estos Términos? Escríbenos a ",
    en: "Questions about these Terms? Write to us at ",
  },
  terms14BodyEnd: { es: ".", en: "." },

  // ── Data deletion ────────────────────────────────────────────────────────
  deleteMetaTitle: { es: "Eliminar mis datos", en: "Delete my data" },
  deleteMetaDescription: {
    es: "Cómo solicitar la eliminación de tus datos en riverz.",
    en: "How to request the deletion of your data at riverz.",
  },
  deleteTitle: { es: "Eliminar mis datos", en: "Delete my data" },

  deleteReceivedTitle: { es: "Solicitud recibida", en: "Request received" },
  deleteReceivedBody1: {
    es: "Tu solicitud de eliminación se está procesando. Código de confirmación:",
    en: "Your deletion request is being processed. Confirmation code:",
  },
  deleteReceivedBody2: {
    es: "Los datos asociados se eliminan o anonimizan en un plazo razonable. Guarda este código por si necesitas referirte a la solicitud.",
    en: "The associated data is deleted or anonymized within a reasonable period. Keep this code in case you need to refer to the request.",
  },

  deleteIntro: {
    es: "En riverz puedes pedir que eliminemos tus datos personales en cualquier momento. Tienes dos formas de hacerlo:",
    en: "At riverz you can request that we delete your personal data at any time. There are two ways to do it:",
  },

  delete1Title: {
    es: "1. Desde Facebook o Instagram",
    en: "1. From Facebook or Instagram",
  },
  delete1Body: {
    es: "Si conectaste tu cuenta o interactuaste con un comercio que usa riverz a través de Facebook o Instagram, puedes quitar la app desde la configuración de tu cuenta de Meta (Configuración → Apps y sitios web). Meta nos notifica automáticamente y procesamos la eliminación de tus datos.",
    en: "If you connected your account or interacted with a merchant that uses riverz through Facebook or Instagram, you can remove the app from your Meta account settings (Settings → Apps and Websites). Meta notifies us automatically and we process the deletion of your data.",
  },

  delete2Title: { es: "2. Por correo", en: "2. By email" },
  delete2BodyPre: { es: "Escríbenos a ", en: "Write to us at " },
  delete2BodyEnd: {
    es: " desde el correo asociado a tu cuenta, o indicando tu identificador o número, y eliminaremos o anonimizaremos tus datos. Te confirmaremos cuando esté hecho.",
    en: " from the email associated with your account, or providing your identifier or number, and we will delete or anonymize your data. We will confirm once it is done.",
  },

  deleteWhatTitle: { es: "Qué eliminamos", en: "What we delete" },
  deleteWhatBody: {
    es: "Mensajes, comentarios, nombre de perfil, identificadores y metadatos de conversación asociados a tu cuenta en nuestra base de datos. Cierta información puede conservarse si la ley lo exige.",
    en: "Messages, comments, profile name, identifiers and conversation metadata associated with your account in our database. Certain information may be retained if required by law.",
  },
} satisfies Namespace;
