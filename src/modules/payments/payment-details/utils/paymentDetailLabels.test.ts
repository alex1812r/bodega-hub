import {
  formatMaskedReference,
  formatPaymentHeading,
  formatRefStitch,
  formatVesStitch,
  paymentMethodLabels,
} from "./paymentDetailLabels";

describe("paymentDetailLabels", () => {
  it("formats payment heading from mock ids", () => {
    expect(formatPaymentHeading("pay-001")).toBe("PAG-001");
    expect(formatPaymentHeading("PAG-0045")).toBe("PAG-0045");
  });

  it("keeps the full id in the heading", () => {
    expect(formatPaymentHeading("22222222-2222-2222-2222-222222222222")).toBe(
      "PAG-22222222-2222-2222-2222-222222222222",
    );
  });

  it("masks reference codes for display", () => {
    expect(formatMaskedReference("998821")).toBe("***8821");
    expect(formatMaskedReference(undefined)).toBe("—");
  });

  it("exposes method labels", () => {
    expect(paymentMethodLabels.pago_movil).toBe("Pago móvil");
  });

  it("formats stitch currency labels", () => {
    expect(formatVesStitch(3650)).toContain("VES");
    expect(formatRefStitch(100)).toContain("REF");
  });
});
