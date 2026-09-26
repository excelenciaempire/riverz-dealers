/**
 * Lo que haría rechazar una plantilla editada desde el tablero, o romper el
 * envío: cambiar las variables (cada una está atada a un dato del pedido),
 * pasarse del largo de Meta, o empezar o terminar con una variable, que Meta
 * no acepta. Devuelve la clave i18n (`automations.*`) del problema.
 */
export function problemaDelTexto(nuevo: string, anterior: string): string | null {
  if (nuevo.length > 1024) return 'tableroMuyLargo';
  const vars = (s: string) => [...new Set(s.match(/\{\{\d+\}\}/g) ?? [])].sort().join(',');
  if (vars(nuevo) !== vars(anterior)) return 'tableroVariablesCambiadas';
  if (/^\{\{\d+\}\}/.test(nuevo) || /\{\{\d+\}\}$/.test(nuevo)) return 'tableroBordeVariable';
  return null;
}
