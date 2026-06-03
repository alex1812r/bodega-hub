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
});
