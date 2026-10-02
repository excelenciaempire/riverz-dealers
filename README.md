# Riverz Dealers

Asistente personal de ventas para vendedores de carros, construido sobre [Riverz CRM](https://github.com/excelenciaempire/riverz-crm).

Inventario de vehículos, oportunidades por comprador, visitas y pruebas de manejo, seguimiento diario y contexto de venta en la bandeja. Interfaz en español e inglés.

## Probar la demo

1. Ejecuta `npm ci`.
2. Ejecuta `npm run demo`.
3. Abre `http://localhost:3000/demo-dealers`.

La demo usa datos de ejemplo en memoria. Permite crear y editar vehículos, oportunidades y citas; al recargar se restablecen los datos. No requiere claves ni accede a cuentas reales.

## Aplicación con datos reales

1. Configura un proyecto Supabase independiente y aplica las migraciones, incluidas `supabase/migrations/375_dealers.sql` y `376_dealer_automations.sql`.
2. Copia `.env.local.example` a `.env.local` y configura las claves de ese proyecto, la URL de Dealers y las integraciones que usarás.
3. Ejecuta `npm run dev` y abre `/panel` después de iniciar sesión.

El despliegue está preparado para Render en `render.yaml`. [Arquitectura, reglas y límites del MVP](docs/dealers.md).

La agenda permite reprogramar citas. En Automatizaciones están las recetas de
seguimiento y recordatorio de citas confirmadas; selecciona una plantilla
aprobada antes de activarlas. Respetan pausas, opt-out, cierre y reprogramación.

## Validación

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## English

Riverz Dealers is an independent vehicle-sales version of Riverz CRM: vehicle inventory, buyer opportunities, appointments and daily follow-up, with English and Spanish UI.

Run `npm ci`, then `npm run demo`, and open `http://localhost:3000/demo-dealers`. Sample data stays in memory and resets on reload. For real accounts, configure a separate Supabase project and the environment variables before deploying to Render.

AI checks live vehicle availability, records buyer preferences and requests appointments. A salesperson confirms the time. Financing, trade-in valuations and the sale remain human decisions.
Appointments can be rescheduled. Dealer automation recipes cover due buyer
follow-ups and confirmed appointment reminders. They require an approved
template before activation and stop when the opportunity is paused or closed,
the buyer opts out, or the appointment is cancelled or rescheduled.

## License and attribution

MIT. Based on Riverz CRM and the original WACRM project by Arnas Donauskas. The original license and notices are preserved.
