import type { SendTemplateStepConfig } from '@/types';

export type TemplateVariant = NonNullable<
  SendTemplateStepConfig['ab_test']
>['variants'][number];

/** A stable 0–99 bucket. It deliberately does not use Math.random(): a contact
 * must keep its variant after a later run of the same automation. */
export function experimentBucket(
  contactId: string,
  stepId: string,
  experimentId: string
): number {
  let hash = 2166136261;
  for (const char of `${contactId}:${stepId}:${experimentId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function selectTemplateVariant(
  config: SendTemplateStepConfig,
  contactId: string,
  stepId: string
): TemplateVariant | null {
  const experiment = config.ab_test;
  if (
    !experiment ||
    !Array.isArray(experiment.variants) ||
    experiment.variants.length !== 2
  )
    return null;
  const [a, b] = experiment.variants;
  if (
    !a?.template_name ||
    !b?.template_name ||
    !Number.isInteger(a.weight) ||
    !Number.isInteger(b.weight)
  )
    return null;
  if (a.weight < 0 || b.weight < 0 || a.weight + b.weight !== 100) return null;
  return experimentBucket(contactId, stepId, experiment.id) < a.weight ? a : b;
}

/** A stored assignment wins over current traffic weights. This keeps a contact
 * on its original variant when a user later changes the traffic split. */
export function keepAssignedVariant(
  config: SendTemplateStepConfig,
  previousVariantId: string | null | undefined,
  contactId: string,
  routingId: string
): TemplateVariant | null {
  const existing = config.ab_test?.variants.find(
    (variant) => variant.id === previousVariantId
  );
  return existing ?? selectTemplateVariant(config, contactId, routingId);
}

export function abTestValidationError(
  config: Record<string, unknown>
): string | null {
  const raw = config.ab_test;
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object')
    return 'experiment configuration is invalid';
  const experiment = raw as { id?: unknown; variants?: unknown };
  if (
    typeof experiment.id !== 'string' ||
    !experiment.id.trim() ||
    !Array.isArray(experiment.variants) ||
    experiment.variants.length !== 2
  ) {
    return 'experiment needs two variants';
  }
  const variants = experiment.variants as Array<Record<string, unknown>>;
  if (
    !variants.every(
      (v) =>
        typeof v.template_name === 'string' &&
        v.template_name.trim() &&
        Number.isInteger(v.weight) &&
        Number(v.weight) >= 0
    )
  ) {
    return 'experiment variants need an approved template and a valid percentage';
  }
  return Number(variants[0].weight) + Number(variants[1].weight) === 100
    ? null
    : 'experiment percentages must add up to 100';
}
