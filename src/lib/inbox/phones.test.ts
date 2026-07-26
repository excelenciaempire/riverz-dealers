import { describe, expect, it } from "vitest";
import { countryOfBusinessNumber, findPhones } from "./phones";

describe("findPhones", () => {
  it("encuentra el número local que el cliente deja para seguir por WhatsApp", () => {
    // Caso real: un DM de Instagram donde la persona sólo escribe su número.
    expect(findPhones("3878514146", "AR")).toEqual([
      { e164: "+543878514146", display: "+54 3878 51 4146" },
    ]);
  });

  it("lo encuentra dentro de una frase y con separadores", () => {
    expect(findPhones("mi whats es 11 5630-9090 gracias", "AR")[0].e164).toBe(
      "+541156309090",
    );
  });

  it("encuentra el internacional aunque no sepamos el país del comercio", () => {
    expect(findPhones("escribime al +57 300 123 4567")[0].e164).toBe("+573001234567");
  });

  it("no inventa teléfonos donde hay precios, fechas o pedidos", () => {
    expect(findPhones("son 2026 pesos, pedido 12", "AR")).toEqual([]);
    expect(findPhones("¿tienen envío a Salta?", "AR")).toEqual([]);
  });

  it("no repite el mismo número escrito de dos formas", () => {
    const found = findPhones("+54 387 851 4146 o 3878514146", "AR");
    expect(found).toHaveLength(1);
  });

  it("tolera texto vacío", () => {
    expect(findPhones(null, "AR")).toEqual([]);
    expect(findPhones("   ", "AR")).toEqual([]);
  });
});

describe("countryOfBusinessNumber", () => {
  it("saca el país del número propio del comercio", () => {
    expect(countryOfBusinessNumber("+54 9 11 7678-3848")).toBe("AR");
    expect(countryOfBusinessNumber("+57 300 123 4567")).toBe("CO");
    expect(countryOfBusinessNumber("")).toBeNull();
  });
});
