import { operationCatalog } from '@/lib/i18n/messages/pitch-operations';
import type { PitchDraft, Feature } from './pitch-data';

const featureByOperation: Record<string, Feature> = {
  abandoned: 'cart',
  discount: 'discount',
  codconvert: 'discount',
  publicsale: 'comments',
  publiccomplaint: 'comments',
  publicfilter: 'comments',
  care: 'aftercare',
  satisfaction: 'aftercare',
  repeat: 'aftercare',
  reactivation: 'aftercare',
  delivered: 'aftercare',
  voicecall: 'voice',
};

export function availableOperations(draft: PitchDraft) {
  return operationCatalog.filter(
    (s) =>
      (!('models' in s) ||
        (s.models as readonly string[]).includes(draft.model)) &&
      (!featureByOperation[s.id] || draft.features[featureByOperation[s.id]])
  );
}

export function selectedOperations(draft: PitchDraft) {
  return availableOperations(draft).filter(
    (s) => !draft.excluded.includes(`operation-${s.id}`)
  );
}
