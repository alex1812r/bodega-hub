/**
 * @jest-environment node
 *
 * PAG-F2 E · la story de `/payments` abre el buscador de documentos, que pide
 * `GET /api/payments/open-documents`. Sin un handler propio la peticion caia en
 * `GET /api/payments/:id` (id = "open-documents") y el buscador salia en error.
 */

type MockResolver = (info: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response> | Response;
type MockHandler = { method: string; path: string; resolver: MockResolver };

// `msw` es ESM puro y jest no lo carga: este doble conserva lo que importa aqui,
// la ruta de cada handler y su orden (MSW responde con el primero que coincide).
jest.mock("msw", () => {
  const register =
    (method: string) =>
    (path: string, resolver: MockResolver): MockHandler => ({ method, path, resolver });

  return {
    http: {
      delete: register("DELETE"),
      get: register("GET"),
      patch: register("PATCH"),
      post: register("POST"),
      put: register("PUT"),
    },
    HttpResponse: {
      json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
    },
  };
});

// Sin `import`: `.storybook/` queda fuera de `npm run typecheck` y un import lo meteria.
const { mswHandlers: handlers } = jest.requireActual<{ mswHandlers: MockHandler[] }>(
  "../../../../.storybook/msw-handlers",
);

/** Parametros de la ruta (`:id`) si `pathname` encaja con `pattern`; si no, `null`. */
function matchPath(pattern: string, pathname: string) {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (const [index, part] of patternParts.entries()) {
    if (part.startsWith(":")) {
      params[part.slice(1)] = pathParts[index];
    } else if (part !== pathParts[index]) {
      return null;
    }
  }

  return params;
}

/** Respuesta del primer handler GET cuya ruta encaja, como hace MSW. */
async function mockedGet(url: string) {
  const request = new Request(`http://localhost${url}`);
  const { pathname } = new URL(request.url);

  for (const handler of handlers) {
    const params = handler.method === "GET" ? matchPath(handler.path, pathname) : null;

    if (params) {
      return { path: handler.path, response: await handler.resolver({ params, request }) };
    }
  }

  throw new Error(`Sin handler para GET ${url}`);
}

describe("Storybook · GET /api/payments/open-documents", () => {
  it("responde la lista de documentos con saldo, no el 404 del detalle de un pago", async () => {
    const { path, response } = await mockedGet("/api/payments/open-documents?limit=10&skip=0");

    expect(path).toBe("/api/payments/open-documents");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { items: Array<{ type: string }>; total: number; totals: unknown };
    };

    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.total).toBeGreaterThanOrEqual(body.data.items.length);
    expect(body.data.totals).toBeDefined();
  });

  it("respeta el filtro de tipo del buscador", async () => {
    for (const type of ["sale", "purchase"]) {
      const { response } = await mockedGet(`/api/payments/open-documents?type=${type}`);
      const body = (await response.json()) as { data: { items: Array<{ type: string }> } };

      expect(body.data.items.length).toBeGreaterThan(0);
      expect(body.data.items.every((item) => item.type === type)).toBe(true);
    }
  });

  it("el detalle de un pago sigue atendiendolo el handler de /api/payments/:id", async () => {
    const { path } = await mockedGet("/api/payments/pay-001");

    expect(path).toBe("/api/payments/:id");
  });
});
