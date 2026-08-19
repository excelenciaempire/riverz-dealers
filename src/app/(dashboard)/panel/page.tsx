import { PanelDashboard } from '@/components/dashboard/panel-dashboard'

/**
 * Inicio, en la aplicación de siempre.
 *
 * El contenido vive en `PanelDashboard` porque Riverz 2.0 lo muestra dentro de
 * su pestaña Panel. Con Riverz 2.0 prendido, esta ruta ni se llega a ver: el
 * layout la manda al chat.
 */
export default function DashboardPage() {
  return <PanelDashboard />
}
