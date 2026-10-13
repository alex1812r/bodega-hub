import "@testing-library/jest-dom";
import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { useIsBelowMd, useMediaQuery } from "./useMediaQuery";

type Listener = () => void;

const originalMatchMedia = window.matchMedia;
let matching = new Set<string>();
let listeners = new Map<string, Set<Listener>>();

function setMatches(query: string, matches: boolean) {
  if (matches) {
    matching.add(query);
  } else {
    matching.delete(query);
  }

  act(() => {
    listeners.get(query)?.forEach((listener) => listener());
  });
}

function Probe({ onRender, query }: { onRender: (matches: boolean) => void; query: string }) {
  const matches = useMediaQuery(query);

  onRender(matches);

  return <span>{matches ? "sí" : "no"}</span>;
}

function BelowMdProbe() {
  return <span>{useIsBelowMd() ? "tarjetas" : "tabla"}</span>;
}

beforeEach(() => {
  matching = new Set();
  listeners = new Map();

  // jsdom no trae matchMedia.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: (_type: string, listener: Listener) => {
        listeners.set(query, (listeners.get(query) ?? new Set()).add(listener));
      },
      get matches() {
        return matching.has(query);
      },
      media: query,
      removeEventListener: (_type: string, listener: Listener) => {
        listeners.get(query)?.delete(listener);
      },
    }),
  });
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("useMediaQuery", () => {
  // DET-F4: un primer render en `false` montaba la tabla antes que las tarjetas.
  it("devuelve el valor real ya en el primer render de cliente", () => {
    const renders: boolean[] = [];

    matching.add("(max-width: 767px)");

    const view = render(
      <Probe onRender={(matches) => renders.push(matches)} query="(max-width: 767px)" />,
    );

    expect(renders[0]).toBe(true);
    expect(renders).not.toContain(false);
    expect(view.getByText("sí")).toBeInTheDocument();
  });

  it("useIsBelowMd monta directamente las tarjetas por debajo de 768 px", () => {
    matching.add("(max-width: 767px)");

    const view = render(<BelowMdProbe />);

    expect(view.getByText("tarjetas")).toBeInTheDocument();
  });

  it("en el servidor devuelve false", () => {
    matching.add("(max-width: 767px)");

    expect(renderToString(<BelowMdProbe />)).toContain("tabla");
  });

  it("se actualiza cuando el media query cambia", () => {
    const view = render(<Probe onRender={() => undefined} query="(min-width: 1024px)" />);

    expect(view.getByText("no")).toBeInTheDocument();

    setMatches("(min-width: 1024px)", true);
    expect(view.getByText("sí")).toBeInTheDocument();

    setMatches("(min-width: 1024px)", false);
    expect(view.getByText("no")).toBeInTheDocument();
  });

  it("deja de escuchar al desmontar y al cambiar de query", () => {
    const view = render(<Probe onRender={() => undefined} query="(min-width: 1024px)" />);

    expect(listeners.get("(min-width: 1024px)")?.size).toBe(1);

    view.rerender(<Probe onRender={() => undefined} query="(max-width: 767px)" />);

    expect(listeners.get("(min-width: 1024px)")?.size).toBe(0);
    expect(listeners.get("(max-width: 767px)")?.size).toBe(1);

    view.unmount();

    expect(listeners.get("(max-width: 767px)")?.size).toBe(0);
  });
});
