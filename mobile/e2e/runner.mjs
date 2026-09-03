/**
 * Runner E2E propio sobre `adb`.
 *
 * En Windows nativo Maestro no existe (solo WSL2), asi que este runner es el
 * primario: interpreta el mismo subconjunto de YAML que Maestro, de modo que los
 * flujos de `e2e/flows/*.yaml` sirven para los dos.
 *
 * Comandos soportados:
 *   - launchApp                      relanza la app
 *   - tapOn: { id: ... } | texto     toca el elemento
 *   - inputText: "..."               escribe en el campo con foco
 *   - assertVisible: { id: ... }     falla si no aparece antes del timeout
 *   - assertNotVisible: { id: ... }
 *   - eraseText                      limpia el campo con foco
 *   - back                           boton atras
 *   - wait: <ms>
 *   - takeScreenshot: nombre
 *
 * Uso:  node e2e/runner.mjs [flujo...]      (sin argumentos corre todos)
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const flowsDir = path.join(here, "flows");
const shotsDir = path.join(here, "screenshots");

const SDK =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const ADB = path.join(SDK, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const APP_ID = process.env.APP_ID ?? "com.bodegahub.app";
const FIND_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 15000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function adb(args, options = {}) {
  const { stdout } = await execFileAsync(ADB, args, {
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout;
}

async function dumpUi() {
  // `uiautomator dump` a stdout evita tener que hacer pull del fichero.
  try {
    return await adb(["exec-out", "uiautomator", "dump", "/dev/tty"]);
  } catch {
    await adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
    return adb(["shell", "cat", "/sdcard/ui.xml"]);
  }
}

/** Los `testID` de React Native llegan como resource-id y content-desc. */
function findNode(xml, selector) {
  const nodes = xml.match(/<node[^>]*\/?>/g) ?? [];

  for (const node of nodes) {
    const attr = (name) => node.match(new RegExp(name + '="([^"]*)"'))?.[1] ?? "";
    const resourceId = attr("resource-id");
    const contentDesc = attr("content-desc");
    const nodeText = attr("text");

    const matches = selector.id
      ? resourceId.endsWith(":id/" + selector.id) ||
        resourceId === selector.id ||
        contentDesc === selector.id
      : nodeText.includes(selector.text) || contentDesc.includes(selector.text);

    if (!matches) continue;

    const bounds = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;

    const x1 = Number(bounds[1]);
    const y1 = Number(bounds[2]);
    const x2 = Number(bounds[3]);
    const y2 = Number(bounds[4]);

    return {
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      width: x2 - x1,
      height: y2 - y1,
      text: nodeText,
    };
  }

  return null;
}

async function waitFor(selector, options = {}) {
  const shouldExist = options.shouldExist ?? true;
  const timeoutMs = options.timeoutMs ?? FIND_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const node = findNode(await dumpUi(), selector);

    if (shouldExist && node) return node;
    if (!shouldExist && !node) return null;

    await sleep(600);
  }

  const label = selector.id ?? selector.text;

  if (shouldExist) {
    throw new Error('No aparecio "' + label + '" en ' + timeoutMs + " ms");
  }

  throw new Error('"' + label + '" seguia visible');
}

function normalizeSelector(value) {
  if (typeof value === "string") return { text: value };
  if (value && value.id) return { id: value.id };
  if (value && value.text) return { text: value.text };
  throw new Error("Selector no reconocido: " + JSON.stringify(value));
}

const commands = {
  async launchApp() {
    await adb(["shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1"]);
    await sleep(3000);
  },
  async tapOn(value) {
    const node = await waitFor(normalizeSelector(value));
    await adb(["shell", "input", "tap", String(node.x), String(node.y)]);
    await sleep(600);
  },
  async inputText(value) {
    // `input text` no admite espacios sin escapar.
    const escaped = String(value).replace(/ /g, "%s");
    await adb(["shell", "input", "text", escaped]);
    await sleep(400);
  },
  async eraseText() {
    await adb(["shell", "input", "keyevent", "KEYCODE_MOVE_END"]);
    for (let index = 0; index < 60; index += 1) {
      await adb(["shell", "input", "keyevent", "KEYCODE_DEL"]);
    }
  },
  async assertVisible(value) {
    await waitFor(normalizeSelector(value));
  },
  async assertNotVisible(value) {
    await waitFor(normalizeSelector(value), { shouldExist: false, timeoutMs: 5000 });
  },
  async back() {
    await adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    await sleep(600);
  },
  async wait(value) {
    await sleep(Number(value) || 1000);
  },
  async takeScreenshot(value, context) {
    const dir = path.join(shotsDir, context.flowName);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, value + ".png");
    const { stdout } = await execFileAsync(ADB, ["exec-out", "screencap", "-p"], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    fs.writeFileSync(file, stdout);
    context.screenshots.push(file);
  },
};

/** Parser minimo del subconjunto de YAML que usan los flujos. */
function parseFlow(source) {
  const steps = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line === "---") continue;
    if (!line.startsWith("- ")) continue;

    const body = line.slice(2).trim();
    const colon = body.indexOf(":");

    if (colon === -1) {
      steps.push({ command: body, value: undefined });
      continue;
    }

    const command = body.slice(0, colon).trim();
    let value = body.slice(colon + 1).trim();

    if (value.startsWith("{")) {
      const entries = value
        .slice(1, -1)
        .split(",")
        .map((pair) => pair.split(":").map((part) => part.trim()));
      value = Object.fromEntries(
        entries.map((entry) => [entry[0], (entry[1] ?? "").replace(/^["']|["']$/g, "")]),
      );
    } else {
      value = value.replace(/^["']|["']$/g, "");
      if (value === "") value = undefined;
    }

    steps.push({ command, value });
  }

  return steps;
}

async function runFlow(file) {
  const flowName = path.basename(file, ".yaml");
  const source = fs.readFileSync(file, "utf8");
  const steps = parseFlow(source);
  const context = { flowName, screenshots: [] };

  process.stdout.write("\n> " + flowName + " (" + steps.length + " pasos)\n");

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const handler = commands[step.command];

    if (!handler) {
      throw new Error("Comando no soportado: " + step.command);
    }

    const label = "  " + String(index + 1).padStart(2) + ". " + step.command;

    try {
      await handler(step.value, context);
      process.stdout.write(label + " OK\n");
    } catch (error) {
      process.stdout.write(label + " FALLO\n");
      // Una captura del fallo vale mas que el mensaje.
      await commands
        .takeScreenshot("fallo-" + (index + 1) + "-" + step.command, context)
        .catch(() => {});
      throw new Error(flowName + " paso " + (index + 1) + " (" + step.command + "): " + error.message);
    }
  }

  return context;
}

async function main() {
  const requested = process.argv.slice(2);
  const files = (
    requested.length > 0
      ? requested.map((name) =>
          name.endsWith(".yaml") ? path.resolve(name) : path.join(flowsDir, name + ".yaml"),
        )
      : fs
          .readdirSync(flowsDir)
          .filter((name) => name.endsWith(".yaml"))
          .sort()
          .map((name) => path.join(flowsDir, name))
  ).filter((file) => fs.existsSync(file));

  if (files.length === 0) {
    process.stdout.write("No hay flujos que ejecutar.\n");
    return;
  }

  const devices = await adb(["devices"]);

  if (!/\bdevice\b/.test(devices.split("\n").slice(1).join("\n"))) {
    throw new Error("No hay ningun dispositivo conectado. Arranca scripts/emulator.ps1.");
  }

  const failures = [];

  for (const file of files) {
    try {
      const context = await runFlow(file);
      process.stdout.write("  capturas: " + context.screenshots.length + "\n");
    } catch (error) {
      failures.push(error.message);
      process.stdout.write("  " + error.message + "\n");
    }
  }

  process.stdout.write("\n" + (files.length - failures.length) + "/" + files.length + " flujos OK\n");

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
