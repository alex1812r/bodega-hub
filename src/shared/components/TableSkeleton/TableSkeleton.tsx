import { Skeleton } from "@/shared/components/Skeleton";

type TableSkeletonProps = {
  columns: number;
  rows?: number;
  showActions?: boolean;
};

export function TableSkeleton({
  columns,
  rows = 5,
  showActions = false,
}: TableSkeletonProps) {
  const columnCount = columns + (showActions ? 1 : 0);

  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columnCount }).map((__, columnIndex) => (
            <td className="px-4 py-3" key={columnIndex}>
              <Skeleton
                className={columnIndex === columnCount - 1 && showActions ? "ml-auto w-10" : "w-full"}
                variant="text"
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
