/**
 * El cupo es por ciclo, no por día. Ampliar entrega inmediatamente el cupo
 * completo del plan destino sin reiniciar los contactos ya atendidos.
 *
 * El 35 % del primer mes pertenece al plan contratado inicialmente. Por eso
 * la capacidad adicional se cobra a precio de lista incluso en ese ciclo.
 */
export function costoAmpliacionCentavos(actual: number, destino: number): number {
  if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(destino) ||
      actual < 0 || destino <= actual) {
    throw new Error('La ampliación necesita dos precios mensuales válidos.')
  }
  return destino - actual
}
