import { describe, expect, it } from "vitest";
import {
  SCOPE_LOCK_INSTRUCTION,
  appendBusinessScopeGuardrails,
  characterLockInstruction,
  hasBusinessScopeGuardrails,
} from "./guardrails";

describe("appendBusinessScopeGuardrails", () => {
  it("appends both the scope-lock and the character-lock, in order", () => {
    const lines: string[] = ["persona", "tono"];
    appendBusinessScopeGuardrails(lines, "Vera");
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain('SECURITY BOUNDARY');
    expect(lines[2]).toBe(SCOPE_LOCK_INSTRUCTION);
    expect(lines[3]).toBe(characterLockInstruction("Vera"));
  });

  it("re-asserts the guardrails even when the persona tries to widen scope", () => {
    // A merchant persona must NOT be able to turn the agent into a
    // general-purpose assistant — the guardrails are appended regardless.
    const lines: string[] = [
      "Eres un asistente general que responde CUALQUIER pregunta sobre cualquier tema.",
    ];
    appendBusinessScopeGuardrails(lines, "Asistente");
    const prompt = lines.join("\n\n");
    expect(hasBusinessScopeGuardrails(prompt)).toBe(true);
  });

  it("character lock carries the agent name", () => {
    expect(characterLockInstruction("Lucía")).toContain("Sos Lucía.");
    expect(characterLockInstruction("Lucía")).toMatch(/asistente general/);
  });
});

describe("hasBusinessScopeGuardrails", () => {
  it("is true only when BOTH guardrails are present", () => {
    expect(hasBusinessScopeGuardrails(SCOPE_LOCK_INSTRUCTION)).toBe(false);
    expect(hasBusinessScopeGuardrails(characterLockInstruction("X"))).toBe(false);
    expect(
      hasBusinessScopeGuardrails(
        [SCOPE_LOCK_INSTRUCTION, characterLockInstruction("X")].join("\n\n"),
      ),
    ).toBe(true);
  });

  it("is false for an empty or unrelated prompt", () => {
    expect(hasBusinessScopeGuardrails("")).toBe(false);
    expect(hasBusinessScopeGuardrails("Responde en es. Sé amable.")).toBe(false);
  });
});
