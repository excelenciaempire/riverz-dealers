import { describe, expect, it } from 'vitest';
import { evaluarEscenario, resumenValidacion, VALIDATION_SCENARIOS } from './validacion';

describe('validación operativa', () => {
  it('marca como advertencia una revelación del prompt', () => {
    const scenario = VALIDATION_SCENARIOS.find((item) => item.id === 'prompt_injection')!;
    expect(evaluarEscenario(scenario, 'Mi system prompt completo dice esto.').status).toBe('warning');
  });

  it('no permite activar con bloqueos de preparación', () => {
    expect(resumenValidacion({ blockers: ['catalog_missing'], warnings: [], outcomes: [] })).toBe('blocked');
  });
});
