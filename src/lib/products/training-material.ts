/**
 * Compilador de `training_material`: la concatenación ordenada del material
 * que el AI runner inyecta verbatim para un producto. El orden importa: lo
 * más autoritario primero (Shopify oficial → override del merchant → AI
 * research → contenido scrapeado), porque algunos modelos privilegian el
 * principio del contexto.
 *
 * Compartido entre el PATCH del producto (editor) y la generación de
 * investigación (ai-research), para que ambos dejen el mismo material
 * compilado y lo investigado SIEMPRE llegue al prompt del agente.
 */
export function buildTrainingMaterial(p: Record<string, unknown>): string {
  const parts: string[] = [];

  const title = p.title as string | null;
  const description = p.description as string | null;
  const productType = p.product_type as string | null;
  const vendor = p.vendor as string | null;
  const tags = (p.tags as string[] | null) ?? [];
  const priceMin = p.price_min as number | null;
  const priceMax = p.price_max as number | null;
  const customNotes = p.custom_notes as string | null;
  const customFaqs = (p.custom_faqs as Array<{ q: string; a: string }> | null) ?? [];
  const aiResearch = p.ai_research as string | null;
  const aiFaqs = (p.ai_generated_faqs as Array<{ q: string; a: string }> | null) ?? [];
  const scraped = p.scraped_content as string | null;
  const bundleApp = p.bundle_app as string | null;

  if (title) parts.push(`# ${title}`);
  if (description) parts.push(`## Descripción\n${description}`);

  const meta: string[] = [];
  if (productType) meta.push(`Tipo: ${productType}`);
  if (vendor) meta.push(`Marca: ${vendor}`);
  if (tags.length > 0) meta.push(`Tags: ${tags.join(', ')}`);
  if (priceMin != null && priceMax != null) {
    meta.push(
      priceMin === priceMax
        ? `Precio: ${priceMin}`
        : `Precio: ${priceMin} – ${priceMax}`,
    );
  }
  if (meta.length > 0) parts.push(meta.join(' · '));

  if (bundleApp) parts.push(`Este producto forma parte de ofertas tipo "${bundleApp}".`);

  if (customNotes && customNotes.trim()) {
    parts.push(`## Notas del merchant\n${customNotes}`);
  }

  // FAQs (custom > AI). Deduplicamos por q normalizada.
  const seenQs = new Set<string>();
  const allFaqs: Array<{ q: string; a: string; source: 'custom' | 'ai' }> = [];
  for (const f of customFaqs) {
    const key = f.q.trim().toLowerCase();
    if (key && !seenQs.has(key)) {
      seenQs.add(key);
      allFaqs.push({ ...f, source: 'custom' });
    }
  }
  for (const f of aiFaqs) {
    const key = f.q.trim().toLowerCase();
    if (key && !seenQs.has(key)) {
      seenQs.add(key);
      allFaqs.push({ ...f, source: 'ai' });
    }
  }
  if (allFaqs.length > 0) {
    const faqLines = allFaqs.map((f) => `- **${f.q}**\n  ${f.a}`).join('\n');
    parts.push(`## Preguntas frecuentes\n${faqLines}`);
  }

  if (aiResearch) parts.push(`## Investigación adicional\n${aiResearch}`);

  if (scraped) {
    parts.push(`## Contenido de la página del producto\n${scraped.slice(0, 8_000)}`);
  }

  return parts.join('\n\n');
}
