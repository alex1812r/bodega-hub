import type { ReactNode } from "react";

type ProductImportStepPanelProps = {
  children: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
};

export function ProductImportStepPanel({
  children,
  footer,
  header,
}: ProductImportStepPanelProps) {
  return (
    <section className="product-import-panel">
      {header ? <div className="product-import-panel__header">{header}</div> : null}
      <div className="product-import-panel__body">{children}</div>
      {footer ? <div className="product-import-panel__footer">{footer}</div> : null}
    </section>
  );
}
