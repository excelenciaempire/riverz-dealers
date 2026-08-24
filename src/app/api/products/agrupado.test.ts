import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Las dos pantallas que muestran el catálogo tienen que agruparlo igual.
 *
 * La regla del plegado se prueba en `src/lib/products/agrupar.test.ts`, contra
 * la función de verdad. Acá se comprueba lo otro: que las dos rutas la usen a
 * ella y no una copia. Este archivo TENÍA una copia de la lógica, y esa copia
 * es exactamente el motivo por el que el selector de productos del agente
 * mostraba el serum cuatro veces mientras la lista de Productos lo mostraba
 * una.
 */

const lista = readFileSync(join(process.cwd(), 'src/app/api/products/route.ts'), 'utf8');
const selector = readFileSync(
  join(process.cwd(), 'src/app/api/shopify/products/route.ts'),
  'utf8',
);

describe('el catálogo se agrupa en un solo lugar', () => {
  it('la lista de Productos usa la función compartida', () => {
    expect(lista).toContain('agruparPorPrincipal');
    expect(lista).toContain('@/lib/products/agrupar');
  });

  it('el selector del agente usa la MISMA función', () => {
    expect(selector).toContain('agruparPorPrincipal');
    expect(selector).toContain('@/lib/products/agrupar');
  });

  it('y pide las columnas sin las que agrupar no puede hacer nada', () => {
    // `master_id` es quien dice qué cuelga de qué; `platform` y `currency`, lo
    // que hace legible la línea de canales. Sin pedirlas, la función corre y
    // devuelve todo suelto — que es como estaba.
    expect(selector).toContain('master_id');
    expect(selector).toContain('platform');
    expect(selector).toContain('currency');
  });
});

describe('el catálogo es de UNA cuenta', () => {
  it('la lista se acota a la cuenta activa, no a "todo lo que este usuario ve"', () => {
    // La consulta se apoyaba sólo en RLS, y RLS deja ver los productos de TODOS
    // los workspaces de los que uno es miembro: quien trabaja en dos cuentas
    // veía un catálogo mezclado, sin ninguna señal de cuál era cuál.
    expect(lista).toContain('resolveWorkspaceIdForUser');
    expect(lista).toContain("eq('workspace_id', activo)");
  });

  it('la divisa sale de esa misma cuenta y no de la primera que aparezca', () => {
    // Con `workspaceIds[0]` los precios de una cuenta se etiquetaban con la
    // moneda de la otra: una tienda argentina mostrando pesos colombianos.
    // Se mira el USO, no la palabra: el comentario que explica el arreglo la
    // menciona, y una prueba que se rompe con su propia explicación no sirve.
    expect(lista).not.toMatch(/resolveWorkspaceCurrency\w*\(\s*admin,\s*workspaceIds/);
    expect(lista).toContain('resolveWorkspaceCurrencyOrNull(admin, activo)');
  });
});
