/**
 * REP-F6 · la leyenda del gráfico es HTML fuera del `<svg>`: la imagen del PDF
 * y del Excel salía sin ella. La captura la lee del DOM para escribirla como
 * texto bajo la imagen.
 */
import { captureChartImage, type CaptureChartDeps } from "./captureChartImage";

const SVG = `<svg class="recharts-surface" width="358" height="179" viewBox="0 0 358 179"><path d="M0 0L10 10" /></svg>`;

function deps(): Partial<CaptureChartDeps> {
  const image = {
    onerror: null as unknown,
    onload: null as unknown,
    set src(_value: string) {
      queueMicrotask(() => (image.onload as () => void)());
    },
  };

  return {
    createCanvas: () => ({
      getContext: () => ({ drawImage: () => undefined, fillRect: () => undefined, fillStyle: "" }),
      height: 0,
      toDataURL: () => "data:image/png;base64,AAAA",
      width: 0,
    }),
    createImage: () => image as unknown as ReturnType<CaptureChartDeps["createImage"]>,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("captureChartImage · leyenda", () => {
  it("recoge las entradas de la leyenda visible, en su orden", async () => {
    // Mismo árbol que `TimeSeriesChart`: la leyenda, y debajo el contenedor del dibujo.
    document.body.innerHTML = `
      <section aria-label="Gráfico: Ventas diarias">
        <div>
          <div>
            <ul>
              <li><span aria-hidden="true"></span><span>Ventas</span></li>
              <li><span aria-hidden="true"></span>Periodo anterior</li>
            </ul>
            <div role="group"><button>REF</button><button>Bs</button></div>
          </div>
          <div role="img" aria-label="Ventas diarias">${SVG}</div>
        </div>
      </section>`;

    expect((await captureChartImage({ deps: deps() }))?.legend).toEqual(["Ventas", "Periodo anterior"]);
  });

  it("sin leyenda en pantalla (una sola serie) la imagen no lleva ninguna", async () => {
    document.body.innerHTML = `
      <section aria-label="Gráfico: Ventas diarias">
        <div><div role="img" aria-label="Ventas diarias">${SVG}</div></div>
      </section>`;

    const image = await captureChartImage({ deps: deps() });

    expect(image).toEqual({ dataUrl: "data:image/png;base64,AAAA", height: 480, width: 960 });
  });
});
