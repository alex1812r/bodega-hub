/**
 * @jest-environment node
 *
 * POS-H1 · barrido de TODAS las rutas del BFF: un cuerpo vacío o que no es JSON
 * es culpa del cliente (400), nunca un 500. Las rutas se descubren por el
 * sistema de archivos: una ruta nueva que lea el cuerpo sin `readJsonBody` /
 * `readOptionalJsonBody` hace fallar este test.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(__dirname, "..", "..");
const API_DIR = __dirname;
const HELPER_FILE = "lib/api/readJsonBody.ts";
const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud no es un JSON válido.";
const INVALID_JSON_ERROR = { code: "BAD_REQUEST", message: INVALID_JSON_MESSAGE };

const HANDLER_EXPORT =
  /export\s+(?:async\s+function|function|const)\s+(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/g;
/** Lectura directa del cuerpo: `x.json()`, `x.text()`… sin argumentos, o `request.body`. */
const RAW_BODY_READ =
  /\.\s*(?:json|text|formData|arrayBuffer|blob|bytes)\s*\(\s*\)|\b(?:request|req)\s*\.\s*body\b/;
/** Fuera de las rutas, nadie más que el helper lee el cuerpo de la petición. */
const REQUEST_BODY_READ =
  /\b(?:request|req)\s*(?:\.\s*clone\s*\(\s*\)\s*)?\.\s*(?:json|text|formData|arrayBuffer|blob|bytes)\s*\(/;
const REQUIRED_HELPER = /\breadJsonBody\s*\(/g;
const OPTIONAL_HELPER = /\breadOptionalJsonBody\s*\(/g;
const READ_ONLY_METHODS = ["GET", "HEAD", "OPTIONS"];
const PARAM_SEGMENT = /\[([^\]]+)\]/g;
const DEMO_ROLES =["admin", "vendedor", "almacen", "contador", "superadmin"];

/**
 * Rutas que pueden leer el cuerpo sin el helper (multipart, webhooks de texto).
 * Clave: ruta relativa a `src/app/api`; valor: motivo. Hoy no hay ninguna.
 */
const RAW_BODY_ALLOWED: Record<string, string> = {};

/**
 * Rutas que leen cuerpo y no se pueden invocar aquí. Clave: `MÉTODO /api/...`;
 * valor: motivo. Siguen cubiertas por las aserciones estáticas. Hoy no hay ninguna.
 */
const DYNAMIC_SKIPPED: Record<string, string> = {};

type BodyMode = "optional" | "required";
type BodyHandler = { file: string; method: string; mode: BodyMode; name: string; url: string };
type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

function walk(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(full, accept);
    }

    return accept(entry.name) ? [full] : [];
  });
}

const toPosix = (file: string) => file.split(path.sep).join("/");
const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;
const helperCalls = (source: string) => count(source, REQUIRED_HELPER) + count(source, OPTIONAL_HELPER);

/** Trozos del fuente por handler exportado: de su `export` al siguiente. */
function handlerSegments(source: string) {
  const matches = [...source.matchAll(HANDLER_EXPORT)];

  return matches.map((match, index) => ({
    code: source.slice(match.index, matches[index + 1]?.index ?? source.length),
    method: match[1],
  }));
}

const routes = walk(API_DIR, (name) => name === "route.ts")
  .sort()
  .map((file) => {
    const relative = toPosix(path.relative(API_DIR, file));
    const source = readFileSync(file, "utf8");

    return { file, relative, segments: handlerSegments(source), source };
  });

const bodyHandlers: BodyHandler[] = routes.flatMap((route) => {
  const url = `/api/${path.posix.dirname(route.relative)}`;

  return route.segments.flatMap((segment): BodyHandler[] => {
    if (helperCalls(segment.code) === 0) {
      return [];
    }

    return [
      {
        file: route.file,
        method: segment.method,
        mode: count(segment.code, OPTIONAL_HELPER) > 0 ? "optional" : "required",
        name: `${segment.method} ${url}`,
        url,
      },
    ];
  });
});

const cases = (mode: BodyMode) =>
  bodyHandlers
    .filter((handler) => handler.mode === mode && !(handler.name in DYNAMIC_SKIPPED))
    .map((handler) => [handler.name, handler] as const);

/**
 * Invoca el handler con sesión demo. Cada ruta pide un permiso distinto (el
 * admin no cobra ni opera caja; plataforma es del superadmin): se usa el primer
 * rol al que la ruta deja pasar. Si ninguno pasa, el 403 hace fallar el test.
 */
async function call(handler: BodyHandler, body: string | undefined) {
  const routeModule = (await import(handler.file)) as Record<string, RouteHandler>;
  const params = Object.fromEntries(
    [...handler.url.matchAll(PARAM_SEGMENT)].map((match) => [match[1], `sweep-${match[1]}`]),
  );
  const url = `http://localhost${handler.url.replace(PARAM_SEGMENT, "sweep-$1")}`;
  let response = new Response(null, { status: 403 });

  for (const role of DEMO_ROLES) {
    const request = new Request(url, {
      body,
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: handler.method,
    });

    response = await routeModule[handler.method](request, { params: Promise.resolve(params) });

    if (response.status !== 401 && response.status !== 403) {
      break;
    }
  }

  return response;
}

describe("POS-H1 · cuerpo JSON en las rutas del BFF", () => {
  describe("estático", () => {
    it("descubre las rutas y sus handlers con cuerpo", () => {
      expect(routes.length).toBeGreaterThan(100);
      expect(bodyHandlers.length).toBeGreaterThanOrEqual(49);
    });

    it("ninguna ruta lee el cuerpo sin el helper", () => {
      const offenders = routes
        .filter((route) => !(route.relative in RAW_BODY_ALLOWED) && RAW_BODY_READ.test(route.source))
        .map((route) => route.relative);

      expect(offenders).toEqual([]);
    });

    it("solo el helper lee el cuerpo de la petición fuera de las rutas", () => {
      const offenders = ["lib", "modules", "shared"]
        .flatMap((dir) =>
          walk(
            path.join(SRC_DIR, dir),
            (name) => /\.tsx?$/.test(name) && !/\.(test|stories)\./.test(name),
          ),
        )
        .filter((file) => toPosix(path.relative(SRC_DIR, file)) !== HELPER_FILE)
        .filter((file) => REQUEST_BODY_READ.test(readFileSync(file, "utf8")))
        .map((file) => toPosix(path.relative(SRC_DIR, file)));

      expect(offenders).toEqual([]);
    });

    it("el helper se llama dentro del handler que lee el cuerpo, que nunca es de lectura", () => {
      const offenders = routes
        .filter((route) => {
          const inHandlers = route.segments.reduce(
            (total, segment) => total + helperCalls(segment.code),
            0,
          );
          const readsInReadOnly = route.segments.some(
            (segment) => READ_ONLY_METHODS.includes(segment.method) && helperCalls(segment.code) > 0,
          );

          return helperCalls(route.source) !== inHandlers || readsInReadOnly;
        })
        .map((route) => route.relative);

      expect(offenders).toEqual([]);
    });

    it("las listas de excepciones apuntan a rutas que existen y llevan motivo", () => {
      const known = new Set(routes.map((route) => route.relative));
      const names = new Set(bodyHandlers.map((handler) => handler.name));
      const reasons = [...Object.values(RAW_BODY_ALLOWED), ...Object.values(DYNAMIC_SKIPPED)];

      expect(Object.keys(RAW_BODY_ALLOWED).filter((key) => !known.has(key))).toEqual([]);
      expect(Object.keys(DYNAMIC_SKIPPED).filter((key) => !names.has(key))).toEqual([]);
      expect(reasons.filter((reason) => reason.trim() === "")).toEqual([]);
    });
  });

  describe("dinámico · cuerpo obligatorio", () => {
    it.each(cases("required"))("%s responde 400 a un cuerpo que no es JSON", async (_name, handler) => {
      const response = await call(handler, "{roto");

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(INVALID_JSON_ERROR);
    });

    it.each(cases("required"))("%s responde 400 a un cuerpo vacío", async (_name, handler) => {
      const response = await call(handler, undefined);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(INVALID_JSON_ERROR);
    });
  });

  describe("dinámico · cuerpo opcional", () => {
    it.each(cases("optional"))("%s responde 400 a un cuerpo que no es JSON", async (_name, handler) => {
      const response = await call(handler, "{roto");

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(INVALID_JSON_ERROR);
    });

    it.each(cases("optional"))("%s sigue aceptando el cuerpo vacío", async (_name, handler) => {
      const response = await call(handler, undefined);
      const body = (await response.json()) as { error?: { code?: string; message?: string } };

      expect(response.status).not.toBe(500);
      expect(body.error?.code).not.toBe("BAD_REQUEST");
      expect(body.error?.message).not.toBe(INVALID_JSON_MESSAGE);
    });
  });
});
