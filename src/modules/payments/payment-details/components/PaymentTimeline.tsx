import { DetailSection } from "@/shared/components/DetailSection";

type PaymentTimelineItem = {
  description: string;
  id: string;
  timestamp: string;
  title: string;
};

type PaymentTimelineProps = {
  items: PaymentTimelineItem[];
};

export function PaymentTimeline({ items }: PaymentTimelineProps) {
  return (
    <DetailSection
      description="Eventos visuales relacionados con el registro del pago."
      title="Linea de tiempo"
    >
      <ol className="space-y-4">
        {items.map((item) => (
          <li className="flex gap-3" key={item.id}>
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-indigo-600" />
            <div>
              <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                {item.title}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {item.description}
              </p>
              <p className="mt-1 text-xs text-slate-400">{item.timestamp}</p>
            </div>
          </li>
        ))}
      </ol>
    </DetailSection>
  );
}
