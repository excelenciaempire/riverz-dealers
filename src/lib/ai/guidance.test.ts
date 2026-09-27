import { describe, it, expect } from 'vitest';
import { cargarReglas, MAX_REGLAS, reglasATexto, type Regla } from './guidance';

it('loads reviewed rules beyond the former 25-rule cutoff', async () => {
  const rows = Array.from({length:29},(_,i)=>regla({id:String(i),hacer:`Rule ${i}`}));
  let limit=0;
  const q={select:()=>q,eq:()=>q,order:()=>q,limit:(n:number)=>{limit=n;return q;},or:()=>q,
    then:(resolve:(value:unknown)=>unknown)=>resolve({data:rows.slice(0,limit)})};
  const result=await cargarReglas({from:()=>q} as never,'w1','a1');
  expect(MAX_REGLAS).toBeGreaterThanOrEqual(29);
  expect(result).toHaveLength(29);
  expect(reglasATexto(result)).toContain('Rule 28');
});

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
