import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  // La suite de regresión del laboratorio de stock corre contra la base lab y
  // puede fallar a propósito: va aparte (`npm run stock-lab:test`).
  // Sin `<rootDir>`: en Windows el patrón no casa dentro de un worktree
  // (`.claude/worktrees/…`), y así también cubre las copias anidadas.
  testPathIgnorePatterns: ["/scripts/stock-lab/regression/"],
  moduleNameMapper: {
    // Jest no resuelve el campo `exports` del workspace enlazado por symlink.
    "^@bodega/core$": "<rootDir>/packages/core/src/index.ts",
    "^@bodega/core/(.*)$": "<rootDir>/packages/core/src/$1",
  },
};

export default createJestConfig(config);
