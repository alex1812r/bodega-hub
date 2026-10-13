import { render } from "@testing-library/react";

import { useReportReady } from "./useReportReady";

function Child({ onReady, ready }: { onReady?: () => void; ready: boolean }) {
  useReportReady(ready, onReady);

  return null;
}

describe("useReportReady", () => {
  it("no avisa mientras los datos no estén listos y avisa al estarlo", () => {
    const onReady = jest.fn();
    const view = render(<Child onReady={onReady} ready={false} />);

    expect(onReady).not.toHaveBeenCalled();

    view.rerender(<Child onReady={onReady} ready />);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("no repite el aviso en los renders siguientes", () => {
    const onReady = jest.fn();
    const view = render(<Child onReady={onReady} ready />);

    view.rerender(<Child onReady={onReady} ready />);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("sin destinatario no hace nada", () => {
    expect(() => render(<Child ready />)).not.toThrow();
  });
});
