import { Card, CardContent, CardHeader } from "@/shared/components/Card";
import { Skeleton } from "@/shared/components/Skeleton";

type DetailSkeletonProps = {
  itemsPerSection?: number;
  sections?: number;
};

export function DetailSkeleton({
  itemsPerSection = 6,
  sections = 2,
}: DetailSkeletonProps) {
  return (
    <div className="space-y-5" role="status">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" variant="text" />
        <Skeleton className="h-9 w-72 max-w-full" variant="text" />
        <Skeleton className="h-4 w-96 max-w-full" variant="text" />
      </div>

      {Array.from({ length: sections }).map((_, sectionIndex) => (
        <Card key={sectionIndex}>
          <CardHeader>
            <Skeleton className="h-5 w-44" variant="text" />
            <Skeleton className="h-4 w-72 max-w-full" variant="text" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: itemsPerSection }).map((__, itemIndex) => (
                <div
                  className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
                  key={itemIndex}
                >
                  <Skeleton className="h-3 w-20" variant="text" />
                  <Skeleton className="mt-2 h-4 w-28" variant="text" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
