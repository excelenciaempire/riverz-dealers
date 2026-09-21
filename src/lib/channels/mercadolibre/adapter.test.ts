import { describe, expect, it } from "vitest";

import { claimAttachmentName } from "./adapter";

describe("claimAttachmentName", () => {
  it("accepts the current file_name response from Mercado Libre", () => {
    expect(claimAttachmentName({ file_name: "seller_proof.jpg", user_id: 12 })).toBe(
      "seller_proof.jpg",
    );
  });

  it("keeps compatibility with filename and id responses", () => {
    expect(claimAttachmentName({ filename: "proof.png" })).toBe("proof.png");
    expect(claimAttachmentName({ id: "legacy-id" })).toBe("legacy-id");
  });

  it("rejects empty or malformed responses", () => {
    expect(claimAttachmentName({ file_name: "  " })).toBeUndefined();
    expect(claimAttachmentName(null)).toBeUndefined();
  });
});
