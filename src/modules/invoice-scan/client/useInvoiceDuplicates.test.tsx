import { act, renderHook, waitFor } from "@testing-library/react";

import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "../contracts";

const mockApiFetch = jest.fn();

jest.mock("../../../shared/api/apiFetch", () => ({
  ...jest.requireActual("../../../shared/api/apiFetch"),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { buildInvoiceDuplicateQuery, fetchInvoiceDuplicates, INVOICE_DUPLICATES_PATH } from "./fetchInvoiceDuplicates";
import { useInvoiceDuplicates } from "./useInvoiceDuplicates";

/** REP12-01 (D52): consulta de duplicados de la revisión con el proveedor elegido. */

const SCAN = "00000000-0000-4000-8000-00000000d002";
const MATCH: InvoiceDuplicateMatch = { scanId: "scan-previo", purchaseId: "purchase-1", number: "1", date: null };

describe("buildInvoiceDuplicateQuery", () => {
  it("omite lo que el endpoint no aceptaría y exige proveedor y número o total", () => {
    expect(
      buildInvoiceDuplicateQuery({
        scanId: SCAN,
        supplierId: "contact-norte",
        contactId: "../x",
        taxId: " J-1 ",
        number: " 0001 ",
        date: "03/09/2026",
        total: 0,
      }),
    ).toEqual({ scanId: SCAN, supplierId: "contact-norte", taxId: "J-1", number: "0001" });
    expect(buildInvoiceDuplicateQuery({ number: "1", total: 10 })).toBeNull();
    expect(buildInvoiceDuplicateQuery({ supplierId: "contact-norte", number: "x".repeat(65) })).toBeNull();
    expect(buildInvoiceDuplicateQuery({ supplierId: "contact-norte", date: "2026-09-03", total: 1750 })).toEqual({
      supplierId: "contact-norte",
      date: "2026-09-03",
      total: 1750,
    });
  });
});

describe("fetchInvoiceDuplicates", () => {
  it("POST con la consulta en el cuerpo (el número no va en la URL, D35)", async () => {
    mockApiFetch.mockResolvedValue([MATCH]);
    const signal = new AbortController().signal;

    await expect(fetchInvoiceDuplicates({ supplierId: "s", number: "1" }, signal)).resolves.toEqual([MATCH]);
    expect(mockApiFetch).toHaveBeenCalledWith(INVOICE_DUPLICATES_PATH, {
      body: { supplierId: "s", number: "1" },
      method: "POST",
      signal,
    });
  });
});

describe("useInvoiceDuplicates", () => {
  it("sin consulta no pide nada", async () => {
    const fetcher = jest.fn(async () => [MATCH]);
    const { result } = renderHook(() => useInvoiceDuplicates(null, fetcher));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.matches).toBeUndefined();
  });

  it("devuelve los de la consulta vigente y aborta la anterior", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = jest.fn(async (query: InvoiceDuplicateQuery, signal: AbortSignal) => {
      signals.push(signal);
      return query.supplierId === "b" ? [MATCH] : [];
    });
    const { rerender, result } = renderHook(({ query }) => useInvoiceDuplicates(query, fetcher), {
      initialProps: { query: { supplierId: "a", number: "1" } as InvoiceDuplicateQuery },
    });

    await waitFor(() => expect(result.current.matches).toEqual([]));
    rerender({ query: { supplierId: "b", number: "1" } });
    // Hasta la respuesta de la consulta nueva no se usa la anterior.
    expect(result.current.matches).toBeUndefined();
    await waitFor(() => expect(result.current.matches).toEqual([MATCH]));
    expect(signals[0].aborted).toBe(true);
  });

  it("si falla, queda sin respuesta (el aviso vuelve al del escaneo)", async () => {
    const fetcher = jest.fn(async () => {
      throw new Error("red");
    });
    const { result } = renderHook(() => useInvoiceDuplicates({ supplierId: "a", number: "1" }, fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(result.current.matches).toBeUndefined();
  });
});
