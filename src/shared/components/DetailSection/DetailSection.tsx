import { type ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { cn } from "@/shared/utils/cn";

type DetailSectionProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  title: string;
};

export function DetailSection({
  actions,
  children,
  className,
  description,
  title,
}: DetailSectionProps) {
  return (
    <Card className={className}>
      <CardHeader
        className={cn(
          "flex flex-col gap-3 md:flex-row md:items-start md:justify-between",
        )}
      >
        <div className="space-y-1.5">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
