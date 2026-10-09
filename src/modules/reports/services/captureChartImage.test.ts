import {
  captureChartImage,
  CHART_IMAGE_SCALE,
  CHART_IMAGE_WIDTH,
  CHART_SVG_SELECTOR,
  collectRootTokens,
  resolveSvgSize,
  type CaptureChartDeps,
} from "./captureChartImage";

const DARK_SERIES = "rgb(99, 102, 241)";
const LIGHT_SERIES = "rgb(79, 70, 229)";
const LIGHT_PAPER = "rgb(255, 255, 255)";
const PNG_DATA_URL = "data:image/png;base64,AAAA";

type FakeCanvas = ReturnType<CaptureChartDeps["createCanvas"]> & {
  calls: string[];
  context: { fillStyle: unknown };
};

function fakeCanvas(overrides: Partial<ReturnType<CaptureChartDeps["createCanvas"]>> = {}) {
  const calls: string[] = [];
  const context = {
    drawImage: (_image: never, x: number, y: number, width: number, height: number) => {
      calls.push(`drawImage ${x} ${y} ${width} ${height}`);
    },
    fillRect: (x: number, y: number, width: number, height: number) => {
      calls.push(`fillRect ${x} ${y} ${width} ${height}`);
    },
    fillStyle: "" as unknown,
  };
  const canvas: FakeCanvas = {
    calls,
    context,
    getContext: () => context,
    height: 0,
    toDataURL: () => PNG_DATA_URL,
    width: 0,
    ...overrides,
  };

  return canvas;
}

/** Imagen que «carga» (o falla) en cuanto recibe `src`. */
function fakeImage(outcome: "error" | "load" | "never" = "load") {
  const image = {
    onerror: null as unknown,
    onload: null as unknown,
    source: "",
    get src() {
      return this.source;
    },
    set src(value: string) {
      this.source = value;

      if (outcome !== "never") {
        queueMicrotask(() => {
          const handler = (outcome === "load" ? image.onload : image.onerror) as () => void;

          handler();
        });
      }
    },
  };

  return image;
}

/**
 * jsdom no resuelve `var(--token)`: se simula el navegador. Dentro del ámbito
 * claro de la captura los colores son los de `:root`; fuera, los del tema
 * oscuro que tiene la app.
 */
function themedComputedStyle(element: Element) {
  const isLightScope = element.closest('[data-chart-export-scope="light"]') !== null;
  const values: Record<string, string> = {
    "background-color": isLightScope ? LIGHT_PAPER : "rgb(15, 23, 42)",
    fill: element.tagName === "rect" ? (isLightScope ? LIGHT_SERIES : DARK_SERIES) : "none",
    "font-size": "11px",
    stroke: element.tagName === "path" ? (isLightScope ? LIGHT_SERIES : DARK_SERIES) : "none",
    "stroke-dasharray": element.hasAttribute("data-previous") ? "5px, 4px" : "",
    "stroke-width": "2px",
  };

  return { getPropertyValue: (property: string) => values[property] ?? "" };
}

function mountChart(svgMarkup: string) {
  document.body.innerHTML = `
    <section aria-label="Gráfico: Ventas diarias">
      <div role="img" aria-label="Ventas diarias">${svgMarkup}</div>
    </section>`;
}

const LINE_CHART = `
  <svg class="recharts-surface" width="358" height="179" viewBox="0 0 358 179">
    <path d="M0 0L10 10" stroke="var(--chart-1)" />
    <path d="M0 5L10 15" stroke="var(--chart-1)" data-previous="" />
    <rect width="10" height="10" fill="var(--chart-1)" />
    <text x="0" y="10">1 sep</text>
  </svg>`;

function setup(overrides: Partial<CaptureChartDeps> = {}) {
  const canvas = fakeCanvas();
  const image = fakeImage();
  const serialized: string[] = [];
  const deps: Partial<CaptureChartDeps> = {
    createCanvas: () => canvas,
    createImage: () => image,
    getComputedStyle: themedComputedStyle,
    serialize: (node) => {
      const xml = new XMLSerializer().serializeToString(node);

      serialized.push(xml);

      return xml;
    },
    ...overrides,
  };

  return { canvas, deps, image, serialized };
}

afterEach(() => {
  document.body.innerHTML = "";
  jest.useRealTimers();
});

describe("captureChartImage", () => {
  it("devuelve el PNG del gráfico visible a 960 px lógicos y 2x, conservando la proporción", async () => {
    mountChart(LINE_CHART);
    const { canvas, deps, image } = setup();

    const result = await captureChartImage({ deps });

    // 358 × 179 (móvil de 390 px) → 960 × 480.
    expect(result).toEqual({ dataUrl: PNG_DATA_URL, height: 480, width: CHART_IMAGE_WIDTH });
    expect(canvas.width).toBe(CHART_IMAGE_WIDTH * CHART_IMAGE_SCALE);
    expect(canvas.height).toBe(480 * CHART_IMAGE_SCALE);
    expect(canvas.calls).toEqual(["fillRect 0 0 1920 960", "drawImage 0 0 1920 960"]);
    expect(image.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  });

  it("pinta con los colores del tema claro aunque la app esté en oscuro", async () => {
    mountChart(LINE_CHART);
    const { canvas, deps, serialized } = setup();

    await captureChartImage({ deps });

    const xml = serialized[0] ?? "";

    expect(xml).toContain(LIGHT_SERIES);
    expect(xml).not.toContain(DARK_SERIES);
    // Fondo del papel: el de la superficie clara.
    expect(canvas.context.fillStyle).toBe(LIGHT_PAPER);
  });

  it("deja en línea trazo, grosor, discontinuidad y tamaño de letra, y fija el tamaño del SVG", async () => {
    mountChart(LINE_CHART);
    const { deps, serialized } = setup();

    await captureChartImage({ deps });

    const svg = new DOMParser().parseFromString(serialized[0] ?? "", "image/svg+xml").documentElement;
    const [line, previous] = Array.from(svg.querySelectorAll("path"));

    expect(svg.getAttribute("width")).toBe("960");
    expect(svg.getAttribute("height")).toBe("480");
    expect(svg.getAttribute("viewBox")).toBe("0 0 358 179");
    expect(line?.getAttribute("style")).toContain(`stroke: ${LIGHT_SERIES}`);
    expect(line?.getAttribute("style")).toContain("stroke-width: 2px");
    expect(previous?.getAttribute("style")).toContain("stroke-dasharray: 5px, 4px");
    expect(svg.querySelector("text")?.getAttribute("style")).toContain("font-size: 11px");
  });

  it("no deja rastro en el documento ni toca el gráfico original", async () => {
    mountChart(LINE_CHART);
    const original = document.querySelector(CHART_SVG_SELECTOR)?.outerHTML;
    const { deps } = setup();

    await captureChartImage({ deps });

    expect(document.querySelector("[data-chart-export-scope]")).toBeNull();
    expect(document.querySelectorAll("svg")).toHaveLength(1);
    expect(document.querySelector(CHART_SVG_SELECTOR)?.outerHTML).toBe(original);
  });

  it("encuentra el gráfico de ranking por su viewBox aunque mida 100 % de ancho", async () => {
    mountChart(
      '<svg class="ranking-bar-chart-surface" width="100%" height="200" viewBox="0 0 640 200"><rect width="5" height="5" /></svg>',
    );
    const { deps } = setup();

    await expect(captureChartImage({ deps })).resolves.toEqual({
      dataUrl: PNG_DATA_URL,
      height: 300,
      width: 960,
    });
  });

  it("sin gráfico devuelve null y no rasteriza nada", async () => {
    document.body.innerHTML = "<main>Solo tabla</main>";
    const createCanvas = jest.fn();

    await expect(captureChartImage({ deps: { createCanvas } })).resolves.toBeNull();
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("el mapa de calor es una tabla HTML: queda sin imagen", async () => {
    document.body.innerHTML = `
      <section aria-label="Gráfico: Ventas por hora y día de la semana">
        <div role="img"><table><tbody><tr><td>3</td></tr></tbody></table></div>
      </section>`;

    await expect(captureChartImage({ deps: setup().deps })).resolves.toBeNull();
  });

  it("un gráfico que aún carga (role=status) no se captura", async () => {
    document.body.innerHTML = `
      <section aria-label="Gráfico: Ventas diarias">
        <div role="status"><svg width="10" height="10"></svg></div>
      </section>`;

    await expect(captureChartImage({ deps: setup().deps })).resolves.toBeNull();
  });

  it.each([
    ["no hay contexto 2D", { createCanvas: () => fakeCanvas({ getContext: () => null }) }],
    [
      "el canvas quedó «tainted»",
      {
        createCanvas: () =>
          fakeCanvas({
            toDataURL: () => {
              throw new DOMException("tainted", "SecurityError");
            },
          }),
      },
    ],
    ["el canvas no sabe exportar PNG", { createCanvas: () => fakeCanvas({ toDataURL: () => "data:," }) }],
    ["la imagen no carga", { createImage: () => fakeImage("error") }],
    [
      "no se puede serializar",
      {
        serialize: () => {
          throw new Error("serialize");
        },
      },
    ],
    [
      "no hay canvas",
      {
        createCanvas: () => {
          throw new Error("canvas");
        },
      },
    ],
  ] as Array<[string, Partial<CaptureChartDeps>]>)(
    "si %s devuelve null sin lanzar",
    async (_case, overrides) => {
      mountChart(LINE_CHART);

      await expect(captureChartImage({ deps: setup(overrides).deps })).resolves.toBeNull();
      expect(document.querySelector("[data-chart-export-scope]")).toBeNull();
    },
  );

  it("si la imagen no termina de cargar, se rinde al vencer el plazo", async () => {
    jest.useFakeTimers();
    mountChart(LINE_CHART);
    const { deps } = setup({ createImage: () => fakeImage("never"), timeoutMs: 4000 });

    const pending = captureChartImage({ deps });

    await jest.advanceTimersByTimeAsync(4000);

    await expect(pending).resolves.toBeNull();
  });

  it("un gráfico sin tamaño no se captura", async () => {
    mountChart('<svg class="recharts-surface"></svg>');

    await expect(captureChartImage({ deps: setup().deps })).resolves.toBeNull();
  });

  it("con el DOM real de jsdom (sin canvas) tampoco lanza", async () => {
    mountChart(LINE_CHART);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(captureChartImage({ deps: { timeoutMs: 20 } })).resolves.toBeNull();
    jest.restoreAllMocks();
  });
});

describe("resolveSvgSize", () => {
  function svg(attributes: string) {
    document.body.innerHTML = `<svg ${attributes}></svg>`;

    return document.querySelector("svg") as Element;
  }

  it("prefiere el viewBox", () => {
    expect(resolveSvgSize(svg('width="100%" height="50" viewBox="0 0 640 200"'))).toEqual({
      height: 200,
      width: 640,
    });
  });

  it("sin viewBox usa width y height", () => {
    expect(resolveSvgSize(svg('width="358" height="179"'))).toEqual({ height: 179, width: 358 });
  });

  it("sin medidas devuelve null", () => {
    expect(resolveSvgSize(svg('viewBox="0 0 0 0"'))).toBeNull();
  });
});

describe("collectRootTokens", () => {
  function style(declarations: Record<string, string>) {
    const names = Object.keys(declarations);

    return {
      ...names,
      getPropertyValue: (name: string) => declarations[name] ?? "",
      length: names.length,
      [Symbol.iterator]: () => names[Symbol.iterator](),
    };
  }

  function rule(selectorText: string, declarations: Record<string, string>) {
    return { selectorText, style: style(declarations) };
  }

  function sheet(cssRules: unknown[]) {
    return { cssRules } as unknown as CSSStyleSheet;
  }

  it("toma los tokens de :root (tema claro) y no los de .dark", () => {
    const tokens = collectRootTokens([
      sheet([
        rule(":root", { "--chart-1": "#4f46e5", "--surface": " #f8f9ff ", color: "red" }),
        rule(".dark", { "--chart-1": "#6366f1" }),
        rule(":root, :host", { "--color-chart-1": "var(--chart-1)" }),
      ]),
    ]);

    expect(Object.fromEntries(tokens)).toEqual({
      "--chart-1": "#4f46e5",
      "--color-chart-1": "var(--chart-1)",
      "--surface": "#f8f9ff",
    });
  });

  it("entra en @layer, pero no en un @media del tema del sistema ni en uno que no aplica", () => {
    const tokens = collectRootTokens(
      [
        sheet([
          { cssRules: [rule(":root", { "--outline": "#777587" })] },
          {
            cssRules: [rule(":root", { "--outline": "#000000" })],
            media: { mediaText: "(prefers-color-scheme: dark)" },
          },
          { cssRules: [rule(":root", { "--outline": "#111111" })], media: { mediaText: "print" } },
          {
            cssRules: [rule(":root", { "--pos-cart-width": "32rem" })],
            media: { mediaText: "(width >= 1024px)" },
          },
        ]),
      ],
      (query) => query !== "print",
    );

    expect(Object.fromEntries(tokens)).toEqual({
      "--outline": "#777587",
      "--pos-cart-width": "32rem",
    });
  });

  it("salta las hojas de otro origen, que no se dejan leer", () => {
    const blocked = {
      get cssRules(): CSSRuleList {
        throw new DOMException("blocked", "SecurityError");
      },
    };

    expect(
      Object.fromEntries(
        collectRootTokens([blocked, sheet([rule(":root", { "--primary": "#4f46e5" })])]),
      ),
    ).toEqual({ "--primary": "#4f46e5" });
  });
});
