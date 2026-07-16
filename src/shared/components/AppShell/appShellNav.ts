import {
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  Home,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { type Permission } from "@/shared/auth/permissions";

export type AppNavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  permission: Permission;
};

export const appNavItems: AppNavItem[] = [
  { href: "/platform/dashboard", icon: Home, label: "Inicio", permission: "platform.dashboard.view" },
  { href: "/platform/stores", icon: Building2, label: "Tiendas", permission: "platform.stores.view" },
  { href: "/platform/users", icon: UserCog, label: "Usuarios", permission: "platform.users.view" },
  { href: "/platform/reports", icon: BarChart3, label: "Reportes", permission: "platform.reports.view" },
  { href: "/dashboard", icon: Home, label: "Inicio", permission: "dashboard.view" },
  { href: "/sales", icon: Receipt, label: "Ventas", permission: "sales.view" },
  { href: "/purchases", icon: ShoppingCart, label: "Compras", permission: "purchases.view" },
  { href: "/inventory", icon: Boxes, label: "Inventario", permission: "inventory.view" },
  { href: "/products", icon: Package, label: "Productos", permission: "products.view" },
  { href: "/contacts", icon: Users, label: "Contactos", permission: "contacts.view" },
  { href: "/payments", icon: CreditCard, label: "Pagos", permission: "payments.view" },
  { href: "/reports", icon: BarChart3, label: "Reportes", permission: "reports.view" },
  { href: "/settings", icon: Settings, label: "Configuracion", permission: "settings.view" },
];
