/**
 * @jest-environment node
 */
/**
 * POS-H2 · `fetchListPage`: el punto único que convierte "página más allá del
 * total" (PostgREST 416 / `PGRST103`) en una página vacía con el total real.
 */

import { ApiError } from "@/lib/api/apiError";

import { fetchListPage, listCountOptions, toPaginatedList } from "./pagination";

/** Lo que entrega `@supabase/postgrest-js` cuando PostgREST responde 416. */
const RANGE_ERROR = {
  count: null,
  data: null,
  error: {
    code: "PGRST103",
    details: "An offset of 999999 was requested, but there are only 7 rows.",
    hint: null,
    message: "Requested range not satisfiable",
  },
  status: 416,
};

describe("fetchListPage", () => {
  it("camino normal: devuelve la página tal cual y NO ejecuta el conteo", async () => {
    const rows = jest.fn().mockResolvedValue({
      count: 42,
      data: [{ id: "a" }, { id: "b" }],
      error: null,
      status: 200,
    });
    const count = jest.fn();

    await expect(fetchListPage({ count, rows })).resolves.toEqual({
      count: 42,
      data: [{ id: "a" }, { id: "b" }],
      error: null,
    });
    expect(rows).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
  });

  it("PGRST103 / 416: página vacía con el total real del conteo", async () => {
    const rows = jest.fn().mockResolvedValue(RANGE_ERROR);
    const count = jest.fn().mockResolvedValue({ count: 7, error: null });

    await expect(fetchListPage({ count, rows })).resolves.toEqual({
      count: 7,
      data: [],
      error: null,
    });
    expect(rows).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["solo el código", { ...RANGE_ERROR, status: undefined }],
    ["solo el estado 416", { ...RANGE_ERROR, error: { message: "Requested range not satisfiable" } }],
  ])("reconoce el rango fuera de total con %s", async (_label, result) => {
    const page = await fetchListPage({
      count: () => Promise.resolve({ count: 3, error: null }),
      rows: () => Promise.resolve(result),
    });

    expect(page).toEqual({ count: 3, data: [], error: null });
  });

  it("un conteo sin número (null) responde total 0, nunca null", async () => {
    const page = await fetchListPage({
      count: () => Promise.resolve({ count: null, error: null }),
      rows: () => Promise.resolve(RANGE_ERROR),
    });

    expect(page.count).toBe(0);
  });

  it("si el conteo también falla, el error se lanza mapeado", async () => {
    const attempt = fetchListPage({
      count: () => Promise.resolve({ count: null, error: { code: "42501", message: "permission denied" } }),
      rows: () => Promise.resolve(RANGE_ERROR),
    });

    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    [{ code: "42501", message: "permission denied for table contacts" }, 403],
    [{ code: "22P02", message: "invalid input syntax for type uuid" }, 400],
    [{ code: "XX000", message: "boom" }, 500],
  ])("otros errores se devuelven sin tocar y sin contar: %j", async (error, status) => {
    const count = jest.fn();
    const page = await fetchListPage({
      count,
      rows: () => Promise.resolve({ count: null, data: null, error, status }),
    });

    expect(page).toEqual({ count: null, data: null, error });
    expect(count).not.toHaveBeenCalled();
    // El servicio lo trata como siempre: `toPaginatedList` lanza el `ApiError` de antes.
    await expect(
      toPaginatedList(new URLSearchParams(), page, (row) => row),
    ).rejects.toMatchObject({ status });
  });

  it("se compone con toPaginatedList: items vacíos, total real y el skip/limit pedidos", async () => {
    const searchParams = new URLSearchParams("skip=999999&limit=20");
    const page = await fetchListPage<{ id: string }>({
      count: () => Promise.resolve({ count: 7, error: null }),
      rows: () => Promise.resolve(RANGE_ERROR),
    });

    await expect(toPaginatedList(searchParams, page, (row) => row.id)).resolves.toEqual({
      items: [],
      limit: 20,
      skip: 999999,
      total: 7,
    });
  });
});

describe("listCountOptions", () => {
  it("la consulta de filas cuenta exacto y la de conteo además es head", () => {
    expect(listCountOptions(false)).toEqual({ count: "exact" });
    expect(listCountOptions(true)).toEqual({ count: "exact", head: true });
  });
});
