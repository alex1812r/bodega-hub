import { act } from "@testing-library/react";

/**
 * Layout de prueba para zonas con scroll (CNF-F1 / CNF-F2). jsdom no calcula
 * alturas: los elementos que `isTarget` reconoce miden `visibleHeight` de alto
 * visible y lo que diga `layout(alto)` de contenido; el resto, 0. Solo para jest.
 */
export function installScrollLayout(isTarget: (element: HTMLElement) => boolean, visibleHeight = 224) {
  const originalResizeObserver = globalThis.ResizeObserver;
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const notifyResize: Array<() => void> = [];
  let contentHeight = 0;

  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      notifyResize.push(() => callback([], this));
    }

    disconnect() {}

    observe() {}

    unobserve() {}
  };

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isTarget(this) ? contentHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isTarget(this) ? visibleHeight : 0;
    },
  });

  return {
    /** El contenido pasa a medir `height` y se avisa a los observadores, como tras un reflow. */
    layout(height: number) {
      contentHeight = height;
      act(() => {
        notifyResize.forEach((notify) => notify());
      });
    },
    restore() {
      globalThis.ResizeObserver = originalResizeObserver;

      if (scrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
      }
      if (clientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
      }
    },
  };
}
