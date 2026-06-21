import { describe, expect, it } from "vitest";
import { listFlowTemplates, getFlowTemplate } from "./templates";

const LOCALES = ["es", "en"] as const;

/**
 * The flow templates are bilingual (tr(locale, es, en)). English copy can be
 * longer than Spanish, so guard the Meta limits the file's header documents:
 * send_buttons titles ≤ 20 chars, send_list row titles ≤ 24. Also assert no
 * user-facing title comes back empty in either locale.
 */
describe("flow templates — Meta limits hold in every locale", () => {
  for (const locale of LOCALES) {
    it(`${locale}: button titles ≤ 20, list rows ≤ 24, no empty titles`, () => {
      for (const tpl of listFlowTemplates(locale)) {
        for (const node of tpl.nodes) {
          const c = node.config as Record<string, unknown>;
          if (node.node_type === "send_buttons") {
            const buttons = (c.buttons as Array<{ title: string }>) ?? [];
            for (const b of buttons) {
              expect(
                b.title.trim().length,
                `${tpl.slug}/${node.node_key} empty button`,
              ).toBeGreaterThan(0);
              expect(
                b.title.length,
                `${tpl.slug}/${node.node_key} button "${b.title}" (${b.title.length})`,
              ).toBeLessThanOrEqual(20);
            }
          }
          if (node.node_type === "send_list") {
            const sections =
              (c.sections as Array<{ rows?: Array<{ title: string }> }>) ?? [];
            for (const s of sections) {
              for (const r of s.rows ?? []) {
                expect(
                  r.title.trim().length,
                  `${tpl.slug}/${node.node_key} empty row`,
                ).toBeGreaterThan(0);
                expect(
                  r.title.length,
                  `${tpl.slug}/${node.node_key} row "${r.title}" (${r.title.length})`,
                ).toBeLessThanOrEqual(24);
              }
            }
          }
        }
      }
    });
  }

  it("en differs from es (content is actually translated)", () => {
    const es = getFlowTemplate("ventas_asesor", "es");
    const en = getFlowTemplate("ventas_asesor", "en");
    const esText = (es!.nodes[0].config as { text: string }).text;
    const enText = (en!.nodes[0].config as { text: string }).text;
    expect(enText).not.toEqual(esText);
  });
});
