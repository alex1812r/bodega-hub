import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { reportCatalog } from "../config/reportCatalog";
import { ReportsCatalog } from "./ReportsCatalog";

// REP-F2: a 1280 px las descripciones ocupaban 2–4 líneas y descuadraban las tarjetas.
describe("ReportsCatalog · descripción de una línea", () => {
  it("cada descripción se pinta en una sola línea y entera en el `title`", () => {
    render(
      <ReportsCatalog
        activeReportId="daily-sales"
        defaultOpen
        onSelect={() => undefined}
        reports={reportCatalog}
      />,
    );

    for (const report of reportCatalog) {
      const description = screen.getByTitle(report.description);

      expect(description).toHaveTextContent(report.description);
      expect(description).toHaveClass("truncate");
    }
  });
});
