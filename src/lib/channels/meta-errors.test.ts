import { describe, it, expect } from 'vitest';
import {
  describeMetaSendError,
  isHumanAgentUnapproved,
  parseMetaError,
} from './meta-errors';

/**
 * El caso real (2026-08-13): un agente contestó un DM de Instagram fuera de la
 * ventana de 24 h, el reintento con la etiqueta HUMAN_AGENT rebotó porque el
 * permiso no está aprobado, y la burbuja terminó mostrando "(#10) To use 'Human
 * Agent', your use of this endpoint must be reviewed and approved by Facebook"
 * — un texto que no le dice al comercio ni qué pasó ni qué hacer.
 */
const HUMAN_AGENT_BODY = JSON.stringify({
  error: {
    message:
      "(#10) To use 'Human Agent', your use of this endpoint must be reviewed and approved by Facebook.",
    type: 'OAuthException',
    code: 10,
  },
});

describe('meta-errors — etiqueta HUMAN_AGENT sin aprobar', () => {
  it('la reconoce', () => {
    expect(isHumanAgentUnapproved(parseMetaError(HUMAN_AGENT_BODY))).toBe(true);
  });

  it('no confunde otros errores con ella', () => {
    const outside = parseMetaError(
      JSON.stringify({
        error: { message: 'outside allowed window', code: 10, error_subcode: 2534022 },
      }),
    );
    expect(isHumanAgentUnapproved(outside)).toBe(false);
  });

  it('se cuenta como ventana de 24 h, con el motivo que el comercio puede resolver', () => {
    const described = describeMetaSendError(
      'instagram',
      400,
      parseMetaError(HUMAN_AGENT_BODY),
    );
    expect(described.category).toBe('outside_window');
    expect(described.permanent).toBe(true);
    expect(described.userMessage).toMatch(/24 horas/i);
    expect(described.userMessage).not.toMatch(/human agent/i);
  });
});
