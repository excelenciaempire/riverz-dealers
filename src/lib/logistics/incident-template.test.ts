import { describe, expect, it } from 'vitest';
import { buildTemplateComponents } from '@/lib/whatsapp/template-components';
import {
  DELIVERY_INCIDENT_TEMPLATES,
  DELIVERY_INCIDENT_VARIABLE_FIELDS,
} from './incident-template';

describe('delivery incident templates', () => {
  it.each(DELIVERY_INCIDENT_TEMPLATES)(
    'builds a valid Meta utility template in $language',
    (definition) => {
      const built = buildTemplateComponents({
        category: definition.category,
        headerType: 'none',
        bodyText: definition.body,
        bodySamples: [...definition.samples],
        buttons: [...definition.buttons],
      });
      expect(built.error).toBeNull();
      expect(Object.keys(DELIVERY_INCIDENT_VARIABLE_FIELDS)).toHaveLength(5);
      expect(built.components.some((component) => component.type === 'BUTTONS')).toBe(true);
    },
  );
});
