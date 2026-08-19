import { OperacionShell } from '@/components/operacion/shell'

/**
 * La pestaña Panel.
 *
 * Sin título propio: el panel ya trae su encabezado con el indicador de datos
 * en vivo, y la pestaña de arriba ya dice dónde estás. Dos títulos apilados
 * era exactamente lo que se veía antes de juntar Inicio con Panel.
 */
export default function OperacionPage() {
  return <OperacionShell />
}
