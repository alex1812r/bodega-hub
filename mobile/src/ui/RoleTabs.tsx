import { Tabs } from "expo-router";

import { useAuth } from "@/auth/AuthContext";
import { getTabsForProfile, type TabDefinition } from "@/auth/roleTabs";
import { testIds } from "@/testIds";
import { useTheme } from "@/theme/ThemeContext";
import { minTouchSize } from "@/theme/tokens";

/**
 * Barra de tabs calculada desde los permisos efectivos, no desde el rol.
 * Una tab sin permiso no se renderiza; la pantalla, si alguien llega por
 * deeplink, muestra `ForbiddenState` (caso de caos 11.5).
 */
export function RoleTabs() {
  const { profile } = useAuth();
  const { theme } = useTheme();

  const visible: TabDefinition[] = profile
    ? getTabsForProfile(profile.role, profile.permissions)
    : [];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.tabBarBorder,
          minHeight: minTouchSize + 12,
        },
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: theme.appSurface },
      }}
    >
      {visible.map((tab) => (
        <Tabs.Screen
          key={tab.key}
          name={tab.route}
          options={{
            title: tab.label,
            tabBarAccessibilityLabel: tab.label,
            tabBarButtonTestID: testIds.tabs.item(tab.key),
          }}
        />
      ))}
    </Tabs>
  );
}
