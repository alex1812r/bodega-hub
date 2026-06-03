/**
 * @jest-environment node
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const sourceDirectory = join(process.cwd(), "src");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function hasAdjacentTest(sourceFile: string) {
  const fileName = basename(sourceFile).replace(/\.(ts|tsx)$/, "");
  const directory = dirname(sourceFile);

  return [".test.ts", ".test.tsx"].some((extension) =>
    existsSync(join(directory, `${fileName}${extension}`)),
  );
}

describe("client API hook coverage", () => {
  it("requires tests for use* hooks that consume /api", () => {
    const hooksWithoutTests = listSourceFiles(sourceDirectory)
      .filter((sourceFile) => /^use[A-Z].*\.(ts|tsx)$/.test(basename(sourceFile)))
      .filter((sourceFile) => {
        const source = readFileSync(sourceFile, "utf8");
        return /fetch\s*\([\s\S]*?["'`]\/api\//.test(source);
      })
      .filter((sourceFile) => !hasAdjacentTest(sourceFile));

    expect(hooksWithoutTests).toEqual([]);
  });
});
