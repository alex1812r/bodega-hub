import { type AppNavItem } from "./appShellNav";
import { AppNavLinks } from "./AppNavLinks";
import { SidebarBrand } from "./SidebarBrand";
import { SidebarFooter } from "./SidebarFooter";

type AppSidebarProps = {
  collapsed?: boolean;
  currentPath: string;
  items: AppNavItem[];
  onSignOut?: () => void;
  userRole?: string;
};

export function AppSidebar({
  collapsed = false,
  currentPath,
  items,
  onSignOut,
  userRole,
}: AppSidebarProps) {
  return (
    <aside
      className="app-sidebar fixed inset-y-0 left-0 z-50 hidden min-w-0 flex-col overflow-x-hidden overflow-y-hidden border-r border-sidebar-foreground/20 bg-sidebar text-sidebar-foreground lg:flex"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <SidebarBrand collapsed={collapsed} userRole={userRole} />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-2">
        <AppNavLinks collapsed={collapsed} currentPath={currentPath} items={items} />
      </div>
      <SidebarFooter collapsed={collapsed} onSignOut={onSignOut} />
    </aside>
  );
}
