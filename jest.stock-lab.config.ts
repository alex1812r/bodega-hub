/**
 * Suite de regresión del laboratorio de stock (`npm run stock-lab:test`).
 *
 * Corre SOLO `scripts/stock-lab/regression/**` contra la base lab local (`pg`).
 * Esos tests pueden fallar a propósito (reproducen bugs sin corregir), por eso
 * `jest.config.ts` (`npm test`) ignora la carpeta.
 */
import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  testEnvironment: "node",
  // `roots` acota el rastreo a scripts/stock-lab (deja fuera las copias del repo
  // en `.claude/worktrees/`). Sin `<rootDir>` en los patrones regex/glob: en
  // Windows no casan cuando la ruta del repo incluye un directorio con punto,
  // que es justo el caso de un worktree.
  roots: ["<rootDir>/scripts/stock-lab"],
  testRegex: ["[\\\\/]regression[\\\\/].*\\.test\\.ts$"],
  // Todos los tests comparten una única base local: en serie.
  maxWorkers: 1,
  testTimeout: 120_000,
  passWithNoTests: true,
  moduleNameMapper: {
    "^@bodega/core$": "<rootDir>/packages/core/src/index.ts",
    "^@bodega/core/(.*)$": "<rootDir>/packages/core/src/$1",
  },
};

export default createJestConfig(config);
