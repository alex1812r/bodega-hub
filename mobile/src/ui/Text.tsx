import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { useTheme } from "@/theme/ThemeContext";
import { typography } from "@/theme/tokens";

type Variant = keyof typeof typography;
type Tone = "default" | "muted" | "subtle" | "danger" | "success" | "primary";

export type TextProps = RNTextProps & {
  variant?: Variant;
  tone?: Tone;
};

export function Text({ variant = "body", tone = "default", style, ...props }: TextProps) {
  const { theme } = useTheme();

  const colors: Record<Tone, string> = {
    default: theme.text,
    muted: theme.textMuted,
    subtle: theme.textSubtle,
    danger: theme.danger,
    success: theme.success,
    primary: theme.primary,
  };

  const { fontSize, fontWeight } = typography[variant];

  return (
    <RNText
      {...props}
      style={[{ color: colors[tone], fontSize, fontWeight }, style]}
    />
  );
}
