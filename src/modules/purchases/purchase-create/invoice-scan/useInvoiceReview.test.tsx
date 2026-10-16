import { act, renderHook } from "@testing-library/react";

import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "./reviewFixtures";
import { useInvoiceReview } from "./useInvoiceReview";

describe("useInvoiceReview", () => {
  it("arma el estado y recalcula el resumen al despachar", () => {
    const response = makeReviewResponse({ lines: [{}, doubtfulLine(2)] });
    const { result } = renderHook(() =>
      useInvoiceReview(response, { systemRateVes: 900, taxRates: REVIEW_TAX_RATES }),
    );

    expect(result.current.summary).toMatchObject({ pendingCount: 1, canLoad: false });

    act(() => {
      result.current.dispatch({ type: "acceptCandidate", index: 1, productId: productUuid(2) });
    });

    expect(result.current.summary).toMatchObject({ pendingCount: 0, canLoad: true });
    expect(result.current.state.lines[1].status).toBe("resolved");
  });
});
