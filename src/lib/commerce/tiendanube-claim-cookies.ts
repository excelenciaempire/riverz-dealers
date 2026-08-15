/**
 * Nombres de cookie del flujo "instalar primero, reclamar después" de
 * Tiendanube. Módulo sin dependencias a propósito: lo importa también el
 * guardián del panel, que corre en el navegador y no puede arrastrar
 * node:crypto ni Supabase al bundle.
 *
 *  - TN_CLAIM_COOKIE (httpOnly): el token de reclamo, sólo servidor. En la
 *    base vive su sha256, así que ni una fuga de base ni un XSS por sí
 *    solos alcanzan para reclamar una tienda.
 *  - TN_CLAIM_HINT_COOKIE (legible por JS): el id de la tienda, sin nada
 *    secreto — sólo para que el panel sepa que hay algo que reclamar
 *    cuando el comercio termine de entrar.
 *
 * Separadas de las de Shopify a propósito: ese flujo está en revisión de
 * la App Store y no se toca para agregar una plataforma.
 */
export const TN_CLAIM_COOKIE = 'tiendanube_claim'
export const TN_CLAIM_HINT_COOKIE = 'tiendanube_claim_store'
