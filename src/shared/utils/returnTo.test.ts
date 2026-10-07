import {
  MAX_RETURN_TO_LENGTH,
  isSafeInternalPath,
  resolveReturnTo,
  withReturnTo,
} from "./returnTo";

const FALLBACK = "/products";

function fromOf(href: string) {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1).split("#")[0]).get("from");
}

describe("withReturnTo", () => {
  it("añade la URL de la lista codificada en from", () => {
    const href = withReturnTo("/products/p-1", "/products?search=coca+cola&page=3");

    expect(href).toBe("/products/p-1?from=%2Fproducts%3Fsearch%3Dcoca%2Bcola%26page%3D3");
    expect(fromOf(href)).toBe("/products?search=coca+cola&page=3");
  });

  it("conserva los parámetros y el hash que ya tenga el enlace", () => {
    const href = withReturnTo("/sales/s-1?tab=pagos&x=a%20b#notas", "/sales?estado=paid");

    expect(href).toBe("/sales/s-1?tab=pagos&x=a%20b&from=%2Fsales%3Festado%3Dpaid#notas");
  });

  it("sustituye un from anterior del enlace", () => {
    const href = withReturnTo("/sales/s-1?from=%2Fviejo&tab=pagos", "/sales");

    expect(href).toBe("/sales/s-1?tab=pagos&from=%2Fsales");
  });

  it("no encadena: elimina el from que traiga la URL de la lista", () => {
    const href = withReturnTo("/contacts/c-1", "/sales?estado=paid&from=%2Fproducts%3Fpage%3D2");

    expect(fromOf(href)).toBe("/sales?estado=paid");
  });

  it("descarta el hash de la URL de la lista", () => {
    expect(fromOf(withReturnTo("/sales/s-1", "/sales?page=2#fila-3"))).toBe("/sales?page=2");
  });

  it("ida y vuelta: resolveReturnTo devuelve la URL exacta de la lista", () => {
    const listUrl = "/purchases?search=harina+pan&estado=pending&estado=partial&dir=desc&page=4";
    const href = withReturnTo("/purchases/abc", listUrl);

    expect(resolveReturnTo(fromOf(href), "/purchases")).toBe(listUrl);
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
});

describe("resolveReturnTo", () => {
  it.each([
    "/products",
    "/products?search=coca+cola&page=3",
    "/inventory/movements?tipo=in&desde=2026-01-01",
    "/products?search=a%2Fb%5Cc%25",
    "/contacts?search=jos%C3%A9#top",
    "/apiary",
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

  it("acepta justo el límite de longitud", () => {
    const from = `/p?s=${"a".repeat(MAX_RETURN_TO_LENGTH - 5)}`;

    expect(from).toHaveLength(MAX_RETURN_TO_LENGTH);
    expect(resolveReturnTo(from, FALLBACK)).toBe(from);
  });

  it("descarta un from anidado dentro de from", () => {
    expect(resolveReturnTo("/sales?estado=paid&from=%2F%2Fevil.com&page=2", FALLBACK)).toBe(
      "/sales?estado=paid&page=2",
    );
    expect(resolveReturnTo("/sales?from=%2Fproducts", FALLBACK)).toBe("/sales");
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
