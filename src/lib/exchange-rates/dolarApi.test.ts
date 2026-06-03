import { fetchOfficialDollarRate } from "./dolarApi";
import { DEFAULT_DOLAR_API_OFFICIAL_URL, DOLAR_API_OFFICIAL_SOURCE } from "./constants";

describe("fetchOfficialDollarRate", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("maps promedio to rateVes", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        moneda: "USD",
        fuente: "oficial",
        nombre: "Dólar",
        compra: null,
        venta: null,
        promedio: 558.6436,
        fechaActualizacion: "2026-06-03T00:00:00-04:00",
      }),
      ok: true,
    }) as typeof fetch;

    const rate = await fetchOfficialDollarRate();

    expect(global.fetch).toHaveBeenCalledWith(
      DEFAULT_DOLAR_API_OFFICIAL_URL,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(rate.rateVes).toBe(558.6436);
    expect(rate.source).toBe(DOLAR_API_OFFICIAL_SOURCE);
    expect(rate.fechaActualizacion).toContain("2026-06-03");
  });

  it("throws when response is not ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as typeof fetch;

    await expect(fetchOfficialDollarRate()).rejects.toMatchObject({
      status: 502,
    });
  });

  it("throws when promedio is invalid", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        moneda: "USD",
        fuente: "oficial",
        nombre: "Dólar",
        promedio: -1,
        fechaActualizacion: "2026-06-03T00:00:00-04:00",
      }),
      ok: true,
    }) as typeof fetch;

    await expect(fetchOfficialDollarRate()).rejects.toMatchObject({
      status: 502,
    });
  });
});
