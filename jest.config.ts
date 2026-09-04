import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    // Jest no resuelve el campo `exports` del workspace enlazado por symlink.
    "^@bodega/core$": "<rootDir>/packages/core/src/index.ts",
    "^@bodega/core/(.*)$": "<rootDir>/packages/core/src/$1",
  },
};

export default createJestConfig(config);
