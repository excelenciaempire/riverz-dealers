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
 *
 * Los encabezados de sección siguen el idioma del merchant (`locale`) para
 * que un merchant de habla inglesa no reciba scaffolding en español dentro
 * del prompt de su agente.
 */
type TmLocale = "es" | "en";

const TM_LABELS: Record<TmLocale, Record<string, string>> = {
  es: {
    description: "Descripción",
    type: "Tipo",
    brand: "Marca",
    tags: "Tags",
    price: "Precio",
    bundle: 'Este producto forma parte de ofertas tipo "{app}".',
    notes: "Notas del merchant",
    faqs: "Preguntas frecuentes",
    research: "Investigación adicional",
    pageContent: "Contenido de la página del producto",
  },
  en: {
    description: "Description",
    type: "Type",
    brand: "Brand",
    tags: "Tags",
    price: "Price",
    bundle: 'This product is part of "{app}"-style offers.',
    notes: "Merchant notes",
    faqs: "FAQs",
    research: "Additional research",
    pageContent: "Product page content",
  },
};

export function buildTrainingMaterial(
  p: Record<string, unknown>,
  locale: TmLocale = "es",
): string {
  const L = TM_LABELS[locale] ?? TM_LABELS.es;
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
  if (description) parts.push(`## ${L.description}\n${description}`);

  const meta: string[] = [];
  if (productType) meta.push(`${L.type}: ${productType}`);
  if (vendor) meta.push(`${L.brand}: ${vendor}`);
  if (tags.length > 0) meta.push(`${L.tags}: ${tags.join(', ')}`);
  if (priceMin != null && priceMax != null) {
    meta.push(
      priceMin === priceMax
        ? `${L.price}: ${priceMin}`
        : `${L.price}: ${priceMin} – ${priceMax}`,
    );
  }
  if (meta.length > 0) parts.push(meta.join(' · '));

  if (bundleApp) parts.push(L.bundle.replace('{app}', bundleApp));

  if (customNotes && customNotes.trim()) {
    parts.push(`## ${L.notes}\n${customNotes}`);
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
    parts.push(`## ${L.faqs}\n${faqLines}`);
  }

  if (aiResearch) parts.push(`## ${L.research}\n${aiResearch}`);

  if (scraped) {
    parts.push(`## ${L.pageContent}\n${scraped.slice(0, 8_000)}`);
  }

  return parts.join('\n\n');
}
