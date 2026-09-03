import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet } from "react-native";

import { useApi } from "@/api/useApi";
import { useAuth } from "@/auth/AuthContext";
import { spacing } from "@/theme/tokens";
import { Card, ErrorState, LoadingState, Screen, Text } from "@/ui";

type ExchangeRate = {
  rateVes: number;
  source?: string;
  validOn?: string;
};

export default function InicioScreen() {
  const api = useApi();
  const { profile } = useAuth();

  const rate = useQuery({
    queryKey: ["exchange-rate", "current"],
    queryFn: () => api<ExchangeRate>("/api/exchange-rates/current"),
  });

  return (
    <Screen subtitle={profile?.user.name} title="Inicio">
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text variant="label" tone="muted">
            Tasa del dia
          </Text>
          {rate.isPending ? (
            <LoadingState label="Consultando la tasa..." />
          ) : rate.isError ? (
            <ErrorState
              description="No pudimos leer la tasa del dia."
              onRetry={() => void rate.refetch()}
              title="Tasa no disponible"
            />
          ) : (
            <Text variant="title">
              Bs. {Number(rate.data?.rateVes ?? 0).toLocaleString("es-VE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          )}
        </Card>

        <Card>
          <Text variant="label" tone="muted">
            Tu sesion
          </Text>
          <Text>Rol: {profile?.role ?? "-"}</Text>
          <Text tone="muted" variant="caption">
            {profile?.permissions.length ?? 0} permisos efectivos
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
