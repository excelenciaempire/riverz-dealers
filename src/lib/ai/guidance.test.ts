import { describe, it, expect } from 'vitest';
import { reglasATexto, type Regla } from './guidance';

const regla = (over: Partial<Regla>): Regla => ({
  id: 'r1',
  workspace_id: 'w1',
  agent_id: null,
  titulo: 'Fechas',
  cuando: null,
  hacer: 'Nunca prometas una fecha exacta.',
  activa: true,
  orden: 0,
  origen: 'comercio',
  clave: null,
  ...over,
});

describe('reglasATexto', () => {
  it('sin reglas no escribe nada', () => {
    // Una sección "Reglas del negocio" vacía le sugiere al modelo que hay
    // reglas que no le contaron, que es peor que no tener sección.
    expect(reglasATexto([])).toBeNull();
  });

  it('descarta las que no dicen qué hacer', () => {
    expect(reglasATexto([regla({ hacer: '   ' })])).toBeNull();
  });

  it('pone el cuándo adelante para que no aplique siempre', () => {
    const texto = reglasATexto([
      regla({ cuando: 'cuando pregunten por envíos', hacer: 'di el rango de la web' }),
    ]);
    expect(texto).toContain('- cuando pregunten por envíos: di el rango de la web');
  });

  it('sin cuándo, la regla vale siempre', () => {
    const texto = reglasATexto([regla({ cuando: '' })]);
    expect(texto).toContain('- Nunca prometas una fecha exacta.');
    expect(texto).not.toContain(': Nunca prometas');
  });

  it('dice que mandan sobre la personalidad', () => {
    // Es la razón de existir de la tabla: la persona describe cómo suena el
    // agente, la regla describe qué puede. Sin decirlo, el modelo las pesa
    // igual y gana la que esté más abajo.
    const texto = reglasATexto([regla({})]) ?? '';
    expect(texto.toLowerCase()).toContain('mandan sobre');
  });
});
