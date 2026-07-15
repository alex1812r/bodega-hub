import { type ReactNode } from "react";

import { Card, CardContent } from "@/shared/components/Card";
import { PageHeader } from "@/shared/components/PageHeader";

type EntityListPageLayout = "card" | "sections";

type EntityListPageProps = {
  actions?: ReactNode;
  children: ReactNode;
  description: string;
  /** `card` wraps children in one Card (listados). `sections` leaves sibling section cards (configuración). */
  layout?: EntityListPageLayout;
  title: string;
};

export function EntityListPage({
  actions,
  children,
  description,
  layout = "card",
  title,
}: EntityListPageProps) {
  return (
    <div className="space-y-5">
      <PageHeader actions={actions} description={description} title={title} />

      {layout === "card" ? (
        <Card>
          <CardContent className="min-w-0 space-y-4 p-4">{children}</CardContent>
        </Card>
      ) : (
        <div className="min-w-0 space-y-4">{children}</div>
      )}
    </div>
  );
}
