import { type AppNavItem } from "./appShellNav";
import { AppNavLinks } from "./AppNavLinks";

type AppSidebarProps = {
  currentPath: string;
  items: AppNavItem[];
};

export function AppSidebar({ currentPath, items }: AppSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:block">
      <div>
        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Control Ventas</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">ERP Web</h1>
      </div>
      <div className="mt-8">
        <AppNavLinks currentPath={currentPath} items={items} />
      </div>
    </aside>
  );
}
