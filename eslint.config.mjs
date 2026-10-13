// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Regla 12 del plan ux-mejoras: nada de diálogos nativos del navegador.
const NATIVE_DIALOGS = ["confirm", "alert", "prompt"];
const NATIVE_DIALOG_MESSAGE =
  "Diálogos nativos prohibidos (regla 12 del plan ux-mejoras): usa ConfirmActionModal para confirmar, Modal para pedir datos y los toasts de src/shared/components/ para avisar.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/mockServiceWorker.js",
    // Worktrees de agentes: copias completas del repo que no se lintan.
    ".claude/**",
    // Notas y scripts de QA de los agentes: carpeta fuera de git (.gitignore).
    ".notes/**",
  ]),
  ...storybook.configs["flat/recommended"],
  {
    // Scripts sueltos de carga de datos que Node ejecuta como CommonJS:
    // require() es su sistema de módulos, no un import olvidado.
    files: ["scripts/chocomayor/*.js", "scripts/ferrera-ferrera/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "packages/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...NATIVE_DIALOGS.map((name) => ({ name, message: NATIVE_DIALOG_MESSAGE })),
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis"].flatMap((object) =>
          NATIVE_DIALOGS.map((property) => ({ object, property, message: NATIVE_DIALOG_MESSAGE })),
        ),
      ],
    },
  },
]);

export default eslintConfig;
