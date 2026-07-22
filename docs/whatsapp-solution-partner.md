# Estatus de partner de Meta para WhatsApp: dónde está Riverz

> Actualizado 2026-07-22. **Corrige una versión previa** que asumía que bitbybit era
> Solution Partner/BSP y que la diferencia con Riverz era OBO vs SELF. Eso era
> incorrecto. Los FAQ públicos de bitbybit lo aclaran: **bitbybit es Tech Partner,
> NO BSP**, corre en coexistencia (COEX) sobre Cloud API + Business App, y el cliente
> paga los mensajes directo a Meta. Es el **mismo modelo operativo que Riverz.**

## Los tres tiers de Meta

| | Tech Provider (Riverz hoy) | Tech Partner (bitbybit) | Solution Partner / BSP |
|---|---|---|---|
| Es Meta Business Partner | No | **Sí** | Sí |
| Modelo | Coexistencia / Cloud API directo | **Igual** que Tech Provider | Puede routear vía BSP |
| WABA del cliente | Bajo el cliente (SELF) | Bajo el cliente (SELF) | Puede ser OBO |
| Quién paga los mensajes | El cliente, directo a Meta | El cliente, directo a Meta | El partner puede facturar |
| Línea de crédito | No | No | Sí (compartible) |
| Capacidad técnica de envío | Completa | **La misma** | Completa |
| Badge oficial + accelerator perks | No | **Sí** | Sí |

Fuentes: [Solution Provider overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview) ·
[Get started for Tech Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) ·
FAQ público de bitbybit (Tech Partner, COEX, sin BSP).

## Lo importante

- **Tech Partner ≈ Tech Provider en capacidades técnicas.** La diferencia es el badge
  de Meta Business Partner + perks de marketing/soporte/visibilidad. NO una capacidad
  de envío distinta.
- **Riverz (Tech Provider) puede hacer todo lo que bitbybit (Tech Partner) hace.** No
  hace falta ser BSP/Solution Partner, ni OBO, para operar coexistencia y enviar.
- El problema de envío de Pilar (131031) **no** es por el tier de partner: es por el
  estado del número (display name en NON_EXISTS + demasiados cambios de partner/BM
  seguidos + Riverz perdió acceso al mover el WABA de BM).

## Qué SÍ desbloquearía subir de tier

**Tech Provider → Tech Partner** (lo que hizo bitbybit): pasar el review de Meta
Business Partner. Da:
- Badge oficial **"Official Meta Tech Partner"** — credibilidad frente a clientes.
- Accelerator perks (visibilidad en el directorio, soporte, marketing).
- NO cambia lo que Riverz puede hacer técnicamente.

**Tech Provider → Solution Partner / BSP**: solo hace falta si querés
- compartir tu línea de crédito para que el cliente no ponga pago, o
- routear API oficial para equipos enterprise que lo exijan.
La mayoría de plataformas (bitbybit incluido) **no** lo necesitan.

## Recomendación

- **Función (Pilar y clientes):** ya la tenés como Tech Provider. Para Pilar: dejar de
  mover el WABA, reconectar Riverz, aprobar el display name, dar tiempo a estabilizar.
- **Credibilidad/marketing:** aplicar al upgrade **Tech Partner** para tener el mismo
  badge oficial que bitbybit. Opcional, no urgente, no cambia la función.
- **BSP/Solution Partner:** solo si en el futuro querés absorber el pago de los
  clientes con tu línea de crédito. No es necesario hoy.
