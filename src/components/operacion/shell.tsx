'use client'

import { CentroOperacion } from './centro'

/**
 * La pestaña Panel: sólo el estado.
 *
 * Antes esto partía la pantalla en dos, con el chat en una barra de 22rem al
 * costado. El chat dejó de ser un panel dentro de otra cosa — ahora es su
 * propia pestaña, a pantalla completa — así que acá queda el centro de control
 * solo, con todo el ancho para crecer.
 */
export function OperacionShell() {
  return <CentroOperacion />
}
