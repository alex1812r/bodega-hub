/**
 * @jest-environment node
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const apiDirectory = join(process.cwd(), "src", "app", "api");
const openApiPath = join(process.cwd(), "public", "openapi.yml");

function listRouteFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listRouteFiles(path);
    }

    return entry === "route.ts" ? [path] : [];
  });
}

function routeFileToApiPath(routeFile: string) {
  const routeDirectory = relative(apiDirectory, routeFile.replace(`${sep}route.ts`, ""));
  const segments = routeDirectory
    .split(sep)
    .filter(Boolean)
    .map((segment) => {
      const dynamicSegment = segment.match(/^\[(.+)]$/);
      return dynamicSegment ? `{${dynamicSegment[1]}}` : segment;
    });

  return `/api/${segments.join("/")}`;
}

function extractOpenApiPaths(openApi: string) {
  return new Set(
    [...openApi.matchAll(/^  (\/api\/[^:\n]+):$/gm)].map((match) => match[1]),
  );
}

type OpenApiOperation = {
  hasRequestBody: boolean;
  id: string;
  responseCodes: string[];
};

/**
 * Operaciones de `paths` con sus códigos de respuesta. Recorrido propio por
 * sangría (el repo no declara ningún parser YAML): ruta a 2 espacios, método a
 * 4, `requestBody`/`responses` a 6 y cada código a 8, que es como está escrito
 * el contrato. Una operación en una sola línea (`get: { summary: … }`) sale sin
 * respuestas, que es justo lo que se quiere detectar.
 */
function extractOpenApiOperations(openApi: string): OpenApiOperation[] {
  const lines = openApi.split(/\r?\n/);
  const pathsStart = lines.indexOf("paths:");
  const operations: OpenApiOperation[] = [];
  let path = "";
  let operation: OpenApiOperation | null = null;
  let inResponses = false;

  for (const line of lines.slice(pathsStart + 1)) {
    if (/^\S/.test(line)) {
      break;
    }

    const pathMatch = line.match(/^ {2}(\/[^:\n]+):$/);
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete):/);
    const codeMatch = line.match(/^ {8}"?(\d{3}|default)"?:/);

    if (pathMatch) {
      path = pathMatch[1];
      operation = null;
    } else if (methodMatch) {
      operation = {
        hasRequestBody: false,
        id: `${methodMatch[1].toUpperCase()} ${path}`,
        responseCodes: [],
      };
      operations.push(operation);
      inResponses = false;
    } else if (/^ {4}\S/.test(line)) {
      operation = null;
    } else if (operation && /^ {6}\S/.test(line)) {
      inResponses = line.startsWith("      responses:");
      operation.hasRequestBody ||= line.startsWith("      requestBody:");
    } else if (operation && inResponses && codeMatch) {
      operation.responseCodes.push(codeMatch[1]);
    }
  }

  return operations;
}

/** Rutas que solo redirigen: su respuesta correcta es 3xx, no 2xx. */
const redirectOnlyOperations = ["GET /api/docs"];

describe("API route contract coverage", () => {
  const routeFiles = listRouteFiles(apiDirectory);

  it("has a route.test.ts next to every route.ts", () => {
    const routesWithoutTests = routeFiles
      .filter((routeFile) => !existsSync(routeFile.replace("route.ts", "route.test.ts")))
      .map((routeFile) => routeFileToApiPath(routeFile));

    expect(routesWithoutTests).toEqual([]);
  });

  it("documents every route.ts path in OpenAPI", () => {
    const openApiPaths = extractOpenApiPaths(readFileSync(openApiPath, "utf8"));
    const undocumentedRoutes = routeFiles
      .map(routeFileToApiPath)
      .filter((routePath) => !openApiPaths.has(routePath));

    expect(undocumentedRoutes).toEqual([]);
  });

  // INT-05 (B5): una clave repetida hace que un parser YAML estricto rechace el contrato entero.
  it("does not document the same path twice in OpenAPI", () => {
    const paths = [...readFileSync(openApiPath, "utf8").matchAll(/^ {2}(\/[^:\n]+):$/gm)].map(
      (match) => match[1],
    );
    const repeated = paths.filter((path, index) => paths.indexOf(path) !== index);

    expect(repeated).toEqual([]);
  });

  describe("OpenAPI operations", () => {
    const operations = extractOpenApiOperations(readFileSync(openApiPath, "utf8"));

    it("reads the operations of the contract", () => {
      expect(operations.length).toBeGreaterThanOrEqual(routeFiles.length);
      expect(operations.map((operation) => operation.id)).toEqual(
        expect.arrayContaining(["GET /api/search", "PUT /api/settings/admin-can-sell"]),
      );
    });

    // POS-H8: una operación sin `responses` no le dice nada a quien integra.
    it("documents a success response for every operation", () => {
      const withoutSuccess = operations
        .filter((operation) => {
          const expected = redirectOnlyOperations.includes(operation.id) ? /^3\d\d$/ : /^2\d\d$/;
          return !operation.responseCodes.some((code) => expected.test(code));
        })
        .map((operation) => operation.id);

      expect(withoutSuccess).toEqual([]);
    });

    // POS-H1: toda ruta que lee cuerpo responde 400 a un JSON inválido.
    it("documents 400 for every operation with a request body", () => {
      const withoutBadRequest = operations
        .filter((operation) => operation.hasRequestBody && !operation.responseCodes.includes("400"))
        .map((operation) => operation.id);

      expect(withoutBadRequest).toEqual([]);
    });
  });
});
