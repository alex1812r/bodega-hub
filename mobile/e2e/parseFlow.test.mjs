/**
 * El parser del runner tiene que entender el mismo YAML que Maestro, o los
 * flujos dejarian de servir para los dos runners.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "runner.mjs"), "utf8");

// El runner no exporta parseFlow (es un script); se extrae para probarlo.
const body = source.match(/function parseFlow\(source\) \{[\s\S]*?\n\}/)[0];
const parseFlow = new Function(`${body}; return parseFlow;`)();

test("ignora comentarios, cabecera y separador", () => {
  const steps = parseFlow(`# comentario\nappId: com.bodegahub.app\n---\n- launchApp\n`);

  assert.deepEqual(steps, [{ command: "launchApp", value: undefined }]);
});

test("lee un selector por id", () => {
  const steps = parseFlow(`---\n- tapOn: { id: login-email }\n`);

  assert.deepEqual(steps, [{ command: "tapOn", value: { id: "login-email" } }]);
});

test("lee un selector por texto plano", () => {
  const steps = parseFlow(`---\n- assertVisible: Cerrar sesion\n`);

  assert.deepEqual(steps, [{ command: "assertVisible", value: "Cerrar sesion" }]);
});

test("conserva el texto con arroba y simbolos", () => {
  const steps = parseFlow(`---\n- inputText: vendedor@example.com\n`);

  assert.equal(steps[0].value, "vendedor@example.com");
});

test("parsea los flujos reales sin comandos desconocidos", () => {
  const supported = new Set([
    "launchApp",
    "tapOn",
    "inputText",
    "eraseText",
    "assertVisible",
    "assertNotVisible",
    "back",
    "wait",
    "takeScreenshot",
  ]);

  const flowsDir = path.join(here, "flows");

  for (const file of fs.readdirSync(flowsDir).filter((name) => name.endsWith(".yaml"))) {
    const steps = parseFlow(fs.readFileSync(path.join(flowsDir, file), "utf8"));

    assert.ok(steps.length > 0, `${file} no tiene pasos`);

    for (const step of steps) {
      assert.ok(supported.has(step.command), `${file}: comando no soportado ${step.command}`);
    }
  }
});
