import { StyleSheet, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/theme/ThemeContext";
import { spacing } from "@/theme/tokens";

import { OfflineBanner } from "./OfflineBanner";
import { Text } from "./Text";

export type ScreenProps = ViewProps & {
  title: string;
  subtitle?: string;
};

/** Cabecera comun + banner de conexion, como el AppShell de la web. */
export function Screen({ title, subtitle, children, style, ...props }: ScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  return (
    <View
      {...props}
      style={[styles.root, { backgroundColor: theme.appSurface, paddingTop: insets.top }, style]}
    >
      <OfflineBanner />
      <View style={styles.header}>
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text tone="muted" variant="caption">
            {subtitle}
          </Text>
        ) : profile ? (
          <Text tone="muted" variant="caption">
            {profile.user.name}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  header: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  root: {
    flex: 1,
  },
});
