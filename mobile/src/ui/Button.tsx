import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/theme/ThemeContext";
import { minTouchSize, radius, spacing } from "@/theme/tokens";

import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  isLoading = false,
  disabled = false,
  testID,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { theme } = useTheme();
  const isDisabled = disabled || isLoading;

  const background: Record<ButtonVariant, string> = {
    primary: theme.primary,
    secondary: theme.card,
    ghost: "transparent",
    danger: theme.danger,
  };

  const label: Record<ButtonVariant, string> = {
    primary: theme.primaryText,
    secondary: theme.text,
    ghost: theme.primary,
    danger: theme.primaryText,
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ busy: isLoading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background[variant],
          borderColor: variant === "secondary" ? theme.border : "transparent",
          minHeight: size === "lg" ? 52 : minTouchSize,
          opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {isLoading ? <ActivityIndicator color={label[variant]} size="small" /> : null}
        <Text variant="label" style={{ color: label[variant], fontSize: size === "lg" ? 16 : 15 }}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  content: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
});
