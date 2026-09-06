import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatSource = readFileSync(
  new URL('./chat-app.tsx', import.meta.url),
  'utf8'
);
const handoffRouteSource = readFileSync(
  new URL('../../app/api/widget/handoff/route.ts', import.meta.url),
  'utf8'
);
const runnerSource = readFileSync(
  new URL('../../lib/ai/runner.ts', import.meta.url),
  'utf8'
);

describe('webchat autónomo', () => {
  it('no ofrece ni ejecuta un traspaso manual desde el widget', () => {
    expect(chatSource).not.toContain('/api/widget/handoff');
    expect(chatSource).not.toContain('Hablar con una persona');
    expect(chatSource).not.toContain('Listo, avisamos al equipo.');
    expect(chatSource).not.toContain('se lo paso al equipo');
    expect(handoffRouteSource).toContain("{ error: 'webchat_ai_only' }");
    expect(handoffRouteSource).not.toContain('pedirHumano');
  });

  it('no convierte fallos automáticos del webchat en atención humana', () => {
    expect(runnerSource).toContain(
      "if (conversation.channel === 'webchat') return;"
    );
    expect(runnerSource).toContain("args.channel === 'webchat'");
    expect(runnerSource).toContain(
      'No pude responder en este momento. Intenta nuevamente.'
    );
    expect(runnerSource).toContain('Canal web autónomo');
  });
});
