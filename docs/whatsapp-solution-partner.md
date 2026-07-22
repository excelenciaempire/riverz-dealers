# Tech Provider → Solution Partner: resumen para aplicar

> Preparado el 2026-07-22 tras el diagnóstico de coexistencia con Pilar. Contexto:
> Riverz es **Tech Provider verificado**. Con ese modelo, el WABA del cliente queda
> bajo **su propio negocio (SELF)** y el cliente debe verificar su negocio + poner
> pago. Con bitbybit (Solution Partner) el WABA colgaba del negocio verificado
> **de ellos (OBO)**, y el cliente no verificaba nada. Ese es el origen del 131031
> que investigamos: no es un bug de Riverz, es la diferencia entre los dos programas.

## Los tres tiers de Meta

| | Tech Provider (Riverz hoy) | Solution Partner (bitbybit) | Tech Partner |
|---|---|---|---|
| Es Meta Business Partner | No | **Sí** | Sí |
| Dónde vive el WABA del cliente | Bajo el negocio del cliente (SELF) | Bajo el negocio del partner (**OBO**) | Bajo el cliente (SELF) |
| Línea de crédito compartible | No | **Sí** | No |
| Quién le paga a Meta | El cliente, directo | El partner factura al cliente | El cliente |
| Verificación del negocio del cliente | La hace el cliente | Puede evitarse (hereda la del partner) | La hace el cliente |
| Verificación por cuenta del cliente | No | **Solo** si es Select o Premier Solution Partner | No |
| Accelerator program | No (salvo upgrade) | Sí | Sí |

Fuentes: [Solution Provider overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview) ·
[Get started for Solution Partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-solution-partners) ·
[Get started for Tech Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)

## Qué desbloquea Solution Partner (lo que a Riverz le importa)

1. **El cliente NO verifica su negocio.** El WABA se crea *on-behalf-of* bajo el
   negocio verificado de Riverz. Elimina el paso que hoy bloquea a Pilar (141010 /
   131031). Este es el beneficio #1 para vos.
2. **El cliente NO configura pago** (si compartís tu línea de crédito). Nota: con
   bitbybit igual recargabas, así que este punto puede no aplicarte tanto — lo que
   sí te aplica es el punto 1.
3. **Verificación acelerada por cuenta del cliente** — solo en tiers Select/Premier.
4. **Creación de WABA iniciada por el partner** (partner-initiated) y facturación
   directa a tus clientes.

## Requisitos para ser Solution Partner

- **Ser aceptado como Meta Business Partner.** Este es el gate real. La doc lo dice
  textual: *"becoming a Solution Partner is a lengthy process."* No es un formulario
  instantáneo; es un programa de partnership con revisión de Meta.
- **App Review con Advanced Access** a los tres permisos:
  `whatsapp_business_management`, `whatsapp_business_messaging`,
  `whatsapp_business_manage_events`.
- **Verificación de tu negocio** (Riverz) — ya la tenés.
- **Two-step verification**: fijar un PIN de 6 dígitos al registrar números.
- **Aceptar los Business Solution Terms** en WhatsApp Manager.
- Embedded Signup implementado con session logging — ya lo tenés.

## Estado de Riverz — qué ya está y qué falta

**Ya en verde (verificado en el dashboard esta noche):**
- Tech Provider **Verified / Completed Onboarding** ✓
- Negocio de Riverz verificado ✓
- App con `whatsapp_business_management` y `whatsapp_business_messaging` en
  *Ready to publish* ✓
- Embedded Signup + coexistencia funcionando (webhooks `smb_*`, featureType, v25) ✓

**Falta:**
- `whatsapp_business_manage_events` está en *Ready for testing* → llevar a Advanced
  Access vía App Review.
- **Aplicar y ser aceptado como Meta Business Partner / Solution Partner** — el paso
  grande, y no depende de código. Se gestiona con Meta (Business Suite / partner
  manager).

## Recomendación

- **Corto plazo (Pilar + clientes actuales):** seguir como Tech Provider. Cada cliente
  verifica su negocio y pone pago. Funciona, con más fricción. Para Pilar puntual:
  verificar el negocio `1070275303133324` + aprobar el display name destraba el envío.
- **Estratégico (competir sin fricción con bitbybit):** aplicar a **Solution Partner**.
  Ya tenés lo caro (negocio verificado + Tech Provider). Falta la aplicación al
  programa de partnership de Meta, que es selectivo y lleva tiempo.

## Antes de aplicar — confirmar con Meta / partner manager

Las condiciones cambian seguido; confirmá con la fuente, no sobre este resumen:
1. Si el modelo OBO **elimina del todo** la verificación del cliente o solo la relaja.
2. Requisitos y criterios de aceptación como Meta Business Partner (¿volumen mínimo,
   invitación, calidad?).
3. Qué desbloquea cada tier (Solution vs Select vs Premier) y cuál necesitás para la
   verificación-por-cuenta-del-cliente.
4. Si desde tu estatus de Tech Provider hay una vía de upgrade directa a Solution
   Partner, o si es una aplicación nueva.
