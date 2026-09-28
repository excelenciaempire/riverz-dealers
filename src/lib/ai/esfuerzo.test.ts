import { describe, expect, it } from 'vitest';
import { esfuerzo } from './esfuerzo';

describe('esfuerzo', () => {
  it('usa between_tools para el mínimo de razonamiento de Sonnet 5.5', () => {
    expect(esfuerzo('claude-sonnet-5-5')).toEqual({
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
    });
  });

  it('conserva adaptive cuando se pide razonamiento en Sonnet 5.5', () => {
    expect(
      esfuerzo('claude-sonnet-5-5', { effort: 'medium', pensar: 'adaptive' })
    ).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
  });

  it('mantiene disabled en modelos que todavía lo aceptan', () => {
    expect(esfuerzo('claude-opus-5')).toEqual({
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    });
  });
});
