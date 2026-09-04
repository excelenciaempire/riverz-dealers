import { describe, expect, it } from 'vitest';
import {
  abTestValidationError,
  keepAssignedVariant,
  selectTemplateVariant,
} from './template-ab-test';

const config = {
  template_name: 'fallback',
  ab_test: {
    id: 'exp-1',
    variants: [
      { id: 'a' as const, template_name: 'a', weight: 50 },
      { id: 'b' as const, template_name: 'b', weight: 50 },
    ] as [
      { id: 'a'; template_name: string; weight: number },
      { id: 'b'; template_name: string; weight: number },
    ],
  },
};

describe('template A/B tests', () => {
  it('keeps a contact on the same variant', () => {
    expect(selectTemplateVariant(config, 'contact-1', 'step-1')).toEqual(
      selectTemplateVariant(config, 'contact-1', 'step-1')
    );
  });
  it('requires exactly 100% traffic', () => {
    expect(
      abTestValidationError({
        ...config,
        ab_test: {
          ...config.ab_test,
          variants: [
            { ...config.ab_test.variants[0], weight: 60 },
            config.ab_test.variants[1],
          ],
        },
      })
    ).toContain('100');
  });
  it('keeps an existing assignment when weights change', () => {
    const changed = {
      ...config,
      ab_test: {
        ...config.ab_test,
        variants: [
          { ...config.ab_test.variants[0], weight: 90 },
          { ...config.ab_test.variants[1], weight: 10 },
        ] as typeof config.ab_test.variants,
      },
    };
    expect(keepAssignedVariant(changed, 'b', 'contact-1', 'step-1')?.id).toBe(
      'b'
    );
  });
});
