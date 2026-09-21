import { describe, expect, it } from 'vitest';
import { buildTrainingMaterial } from './training-material';

describe('product page training material', () => {
  it('keeps the full bounded multi-page snapshot including content near the end', () => {
    const scraped = `${'a'.repeat(9_000)}BOTTOM-OF-PAGE-FAQ${'b'.repeat(2_000)}`;
    const material = buildTrainingMaterial({ title: 'Product', scraped_content: scraped });
    expect(material).toContain('BOTTOM-OF-PAGE-FAQ');
    expect(material).toContain(scraped);
  });
});
