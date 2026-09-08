// Arranca `next dev` con la fuente de datos mock y el login demo activados,
// sin depender de la sintaxis de variables de entorno del shell (Windows/POSIX).
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  API_DATA_SOURCE: "mock",
  NEXT_PUBLIC_API_DATA_SOURCE: "mock",
  ALLOW_DEMO_AUTH: "true",
  NEXT_PUBLIC_ALLOW_DEMO_AUTH: "true",
};

const port = process.env.PORT ?? "3000";
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--webpack", "-p", port],
  { stdio: "inherit", env, shell: process.platform === "win32" },
);
child.on("exit", (code) => process.exit(code ?? 0));
