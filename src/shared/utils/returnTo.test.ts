import {
  MAX_RETURN_TO_LENGTH,
  RETURN_TO_PARAM,
  isSafeInternalPath,
  resolveReturnTo,
  safeInternalPath,
  withReturnTo,
} from "./returnTo";

const FALLBACK = "/products";

function returnToOf(href: string) {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1).split("#")[0]).get("returnTo");
}

describe("withReturnTo", () => {
  it("añade la URL de la lista codificada en returnTo", () => {
    const href = withReturnTo("/products/p-1", "/products?search=coca+cola&page=3");

    expect(href).toBe("/products/p-1?returnTo=%2Fproducts%3Fsearch%3Dcoca%2Bcola%26page%3D3");
    expect(returnToOf(href)).toBe("/products?search=coca+cola&page=3");
  });

  it("conserva los parámetros y el hash que ya tenga el enlace", () => {
    const href = withReturnTo("/sales/s-1?tab=pagos&x=a%20b#notas", "/sales?estado=paid");

    expect(href).toBe("/sales/s-1?tab=pagos&x=a%20b&returnTo=%2Fsales%3Festado%3Dpaid#notas");
  });

  it("sustituye un returnTo anterior del enlace", () => {
    const href = withReturnTo("/sales/s-1?returnTo=%2Fviejo&tab=pagos", "/sales");

    expect(href).toBe("/sales/s-1?tab=pagos&returnTo=%2Fsales");
  });

  it("no encadena: elimina el returnTo que traiga la URL de la lista", () => {
    const href = withReturnTo("/contacts/c-1", "/sales?estado=paid&returnTo=%2Fproducts%3Fpage%3D2");

    expect(returnToOf(href)).toBe("/sales?estado=paid");
  });

  it("descarta el hash de la URL de la lista", () => {
    expect(returnToOf(withReturnTo("/sales/s-1", "/sales?page=2#fila-3"))).toBe("/sales?page=2");
  });

  it("ida y vuelta: resolveReturnTo devuelve la URL exacta de la lista", () => {
    const listUrl = "/purchases?search=harina+pan&estado=pending&estado=partial&dir=desc&page=4";
    const href = withReturnTo("/purchases/abc", listUrl);

    expect(resolveReturnTo(returnToOf(href), "/purchases")).toBe(listUrl);
  });

  it.each([
    ["sin URL de lista", ""],
    ["null", null],
    ["undefined", undefined],
    ["URL absoluta", "https://evil.com/products"],
    ["protocolo relativo", "//evil.com"],
    ["ruta a la API", "/api/products"],
    ["demasiado larga", `/products?search=${"a".repeat(MAX_RETURN_TO_LENGTH)}`],
  ])("deja el enlace igual con %s", (_label, currentUrl) => {
    expect(withReturnTo("/products/p-1?tab=stock", currentUrl)).toBe("/products/p-1?tab=stock");
  });

  // Los surrogates se construyen en ejecución: escritos como escape en el fuente,
  // el compilador los sustituye por U+FFFD y el caso deja de reproducir el fallo.
  const HIGH = String.fromCharCode(0xd83d);
  const LOW = String.fromCharCode(0xde00);

  it.each([
    ["alto suelto", `/products?search=${HIGH}`],
    ["bajo suelto", `/products?search=${LOW}x`],
    ["suelto en la ruta", `/products/${HIGH}`],
  ])("no lanza con un surrogate %s en la URL de la lista y deja el enlace igual", (_label, currentUrl) => {
    expect(() => withReturnTo("/products/p-1?tab=stock", currentUrl)).not.toThrow();
    expect(withReturnTo("/products/p-1?tab=stock", currentUrl)).toBe("/products/p-1?tab=stock");
  });

  it("sigue aceptando un par surrogate completo (emoji) en la URL de la lista", () => {
    const listUrl = `/products?search=${HIGH}${LOW}`;

    expect(returnToOf(withReturnTo("/products/p-1", listUrl))).toBe(listUrl);
  });
});

describe("resolveReturnTo", () => {
  it.each([
    "/products",
    "/products?search=coca+cola&page=3",
    "/inventory/movements?tipo=in&desde=2026-01-01",
    "/products?search=a%2Fb%5Cc%25",
    "/contacts?search=jos%C3%A9#top",
    "/apiary",
    "/login",
    "/login?next=%2Fproducts%3Fpage%3D2",
    "/login?next=%2Fsales%3Fnext%3D%252Fproducts",
    "/sales?redirect=%2Fdashboard&page=2",
    "/products?siguiente=%2F%5Cevil.example",
  ])("acepta la ruta interna %s", (from) => {
    expect(resolveReturnTo(from, FALLBACK)).toBe(from);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["vacío", ""],
    ["URL absoluta https", "https://evil.com"],
    ["URL absoluta http", "http://evil.com/products"],
    ["protocolo relativo", "//evil.com"],
    ["protocolo relativo con ruta", "//evil.com/products"],
    ["barras invertidas", "\\\\evil.com"],
    ["barra y barra invertida", "/\\evil.com"],
    ["barra invertida interior", "/products\\..\\evil"],
    ["javascript:", "javascript:alert(1)"],
    ["JavaScript: con mayúsculas", "JaVaScRiPt:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["salto de línea", "/products\nSet-Cookie: a=b"],
    ["retorno de carro", "/products\r\n"],
    ["tabulador", "/\t/evil.com"],
    ["tabulador inicial", "\t/products"],
    ["carácter nulo", "/products\u0000"],
    ["DEL", "/products\u007f"],
    ["separador de línea unicode", "/products "],
    ["espacio inicial", " /products"],
    ["codificación doble de //", "%2F%2Fevil.com"],
    ["barra codificada en la ruta", "/%2F%2Fevil.com"],
    ["barra codificada en minúsculas", "/%2f/evil.com"],
    ["barra invertida codificada", "/%5Cevil.com"],
    ["barra invertida codificada sola", "%5C%5Cevil.com"],
    ["porcentaje codificado en la ruta", "/%252F%252Fevil.com"],
    ["control codificado en la ruta", "/products%0d%0aSet-Cookie"],
    ["no empieza por /", "products"],
    ["relativa con punto", "./products"],
    ["solo query", "?page=2"],
    ["segmento ..", "/products/../api/users"],
    ["segmento .. codificado", "/products/%2e%2e/api/users"],
    ["segmento .", "/./api/users"],
    ["doble barra interior", "/products//evil.com"],
    ["ruta a la API", "/api/products"],
    ["raíz de la API", "/api"],
    ["API con query", "/api?x=1"],
    ["API en mayúsculas", "/API/products"],
    ["usuario@host", "https://app@evil.com"],
    ["demasiado largo", `/products?search=${"a".repeat(MAX_RETURN_TO_LENGTH)}`],
  ])("rechaza %s y usa fallbackHref", (_label, from) => {
    expect(resolveReturnTo(from, FALLBACK)).toBe(FALLBACK);
  });

  it.each([
    ["next con barra invertida", "/login?next=%2F%5Cevil.example%2Frobo"],
    ["next con tabulador", "/login?next=%2F%09%2Fevil.example%2Frobo"],
    ["next de protocolo relativo", "/login?next=%2F%2Fevil.example%2Frobo"],
    ["next absoluto", "/login?next=https%3A%2F%2Fevil.example"],
    ["next javascript:", "/login?next=javascript%3Aalert(1)"],
    ["next a la API", "/login?next=%2Fapi%2Fusers"],
    ["next vacío", "/login?next="],
    ["next en mayúsculas", "/login?NEXT=%2F%5Cevil.example"],
    ["clave next codificada", "/login?%6Eext=%2F%5Cevil.example"],
    ["next repetido, el segundo hostil", "/login?next=%2Fproducts&next=%2F%5Cevil.example"],
    ["next hostil tras otros parámetros", "/sales?page=2&next=%2F%5Cevil.example#top"],
    ["next hostil anidado dos niveles", "/login?next=%2Flogin%3Fnext%3D%252F%255Cevil.example"],
    ["redirect hostil", "/login?redirect=%2F%5Cevil.example"],
    ["redirectTo hostil", "/login?redirectTo=%2F%2Fevil.example"],
    ["redirect_to hostil", "/login?redirect_to=https%3A%2F%2Fevil.example"],
    ["returnTo hostil", "/login?returnTo=%2F%5Cevil.example"],
    ["return_to hostil", "/login?return_to=%2F%5Cevil.example"],
    ["callbackUrl hostil", "/login?callbackUrl=%2F%5Cevil.example"],
  ])("rechaza un parámetro de redirección inseguro en la query: %s", (_label, from) => {
    expect(resolveReturnTo(from, FALLBACK)).toBe(FALLBACK);
    expect(isSafeInternalPath(from)).toBe(false);
  });

  it("rechaza el returnTo del reporte tal como llega de searchParams.get", () => {
    const detailUrl = "/qa-caos-back?returnTo=%2Flogin%3Fnext%3D%252F%255Cevil.example%252Frobo";
    const from = new URLSearchParams(detailUrl.slice(detailUrl.indexOf("?") + 1)).get(
      RETURN_TO_PARAM,
    );

    expect(from).toBe("/login?next=%2F%5Cevil.example%2Frobo");
    expect(resolveReturnTo(from, FALLBACK)).toBe(FALLBACK);
  });

  it("acepta justo el límite de longitud", () => {
    const from = `/p?s=${"a".repeat(MAX_RETURN_TO_LENGTH - 5)}`;

    expect(from).toHaveLength(MAX_RETURN_TO_LENGTH);
    expect(resolveReturnTo(from, FALLBACK)).toBe(from);
  });

  it("descarta un returnTo interno anidado dentro de returnTo", () => {
    expect(
      resolveReturnTo("/sales?estado=paid&returnTo=%2Fproducts%3Fpage%3D2&page=2", FALLBACK),
    ).toBe("/sales?estado=paid&page=2");
    expect(resolveReturnTo("/sales?returnTo=%2Fproducts", FALLBACK)).toBe("/sales");
  });

  it("rechaza entero un destino con un returnTo anidado hostil", () => {
    expect(resolveReturnTo("/sales?estado=paid&returnTo=%2F%2Fevil.com&page=2", FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveReturnTo("/sales?ReturnTo=%2F%5Cevil.example", FALLBACK)).toBe(FALLBACK);
  });
});

describe("el filtro de fechas from no es el parámetro de retorno", () => {
  const SALES_LIST = "/sales?from=2026-10-01&to=2026-10-31&status=paid";

  it("el parámetro de retorno se llama returnTo", () => {
    expect(RETURN_TO_PARAM).toBe("returnTo");
  });

  it("ida y vuelta: Volver conserva íntegra una lista filtrada por from y to", () => {
    const href = withReturnTo("/sales/123", SALES_LIST);

    expect(href).toBe(
      "/sales/123?returnTo=%2Fsales%3Ffrom%3D2026-10-01%26to%3D2026-10-31%26status%3Dpaid",
    );
    expect(resolveReturnTo(returnToOf(href), "/sales")).toBe(SALES_LIST);
  });

  it("withReturnTo no borra un from que ya tenga el enlace", () => {
    expect(withReturnTo("/reports/daily?from=2026-10-01&to=2026-10-07", "/reports")).toBe(
      "/reports/daily?from=2026-10-01&to=2026-10-07&returnTo=%2Freports",
    );
  });

  it("un from dentro del destino es un filtro: ni se borra ni se inspecciona como redirección", () => {
    expect(resolveReturnTo(SALES_LIST, FALLBACK)).toBe(SALES_LIST);
    expect(resolveReturnTo("/sales?from=%2F%2Fevil.com&page=2", FALLBACK)).toBe(
      "/sales?from=%2F%2Fevil.com&page=2",
    );
  });
});

describe("isSafeInternalPath", () => {
  it("rechaza valores que no son texto", () => {
    expect(isSafeInternalPath(undefined)).toBe(false);
    expect(isSafeInternalPath(42)).toBe(false);
    expect(isSafeInternalPath(["/products"])).toBe(false);
  });

  it("acepta la raíz", () => {
    expect(isSafeInternalPath("/")).toBe(true);
  });
});

describe("safeInternalPath", () => {
  it.each(["/products?page=2", "/dashboard", "/sales/s-1?tab=pagos#notas", "/"])(
    "devuelve %s tal cual",
    (value) => {
      expect(safeInternalPath(value, FALLBACK)).toBe(value);
    },
  );

  it("conserva el returnTo de una ruta interna (no lo elimina como resolveReturnTo)", () => {
    expect(safeInternalPath("/sales/s-1?returnTo=%2Fsales%3Fpage%3D2", FALLBACK)).toBe(
      "/sales/s-1?returnTo=%2Fsales%3Fpage%3D2",
    );
  });

  it.each([
    ["null", null],
    ["vacío", ""],
    ["barra y barra invertida", "/\\evil.example/robo"],
    ["tabulador", "/\t/evil.example/robo"],
    ["protocolo relativo", "//evil.example/robo"],
    ["URL absoluta", "https://evil.example/robo"],
    ["javascript:", "javascript:alert(1)"],
    ["ruta a la API", "/api/auth/logout"],
    ["next hostil anidado", "/login?next=%2F%5Cevil.example"],
  ])("devuelve el fallback con %s", (_label, value) => {
    expect(safeInternalPath(value, FALLBACK)).toBe(FALLBACK);
  });
});
