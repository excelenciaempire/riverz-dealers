import { permanentRedirect } from 'next/navigation';

/**
 * La documentación pasó de cinco rutas a una sola con anclas. Esta redirección
 * queda porque un enlace que alguien ya guardó no se rompe por un cambio de
 * estructura interno.
 */
export default function RedirMcp(): never {
  permanentRedirect('/documentacion#conexion');
}
