import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { InfoGrid } from "./InfoGrid";

describe("InfoGrid", () => {
  it("renders label and value pairs", () => {
    const { getByText } = render(
      <InfoGrid items={[{ label: "Precio ref", value: "ref 4.20" }]} />,
    );

    expect(getByText(/precio ref/i)).toBeVisible();
    expect(getByText("ref 4.20")).toBeVisible();
  });
});
