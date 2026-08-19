import { redirect } from 'next/navigation'

/**
 * El centro de operación se juntó con Inicio.
 *
 * Eran dos pantallas contando mitades del mismo cuadro. La ruta se queda como
 * redirección y no se borra porque hay links viejos apuntando acá —el asistente
 * de activación vive en `/operacion/activar`— y un 404 no explica nada.
 */
export default function OperacionPage() {
  redirect('/panel')
}
