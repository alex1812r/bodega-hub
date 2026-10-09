"use client";

import { QueryClientContext, type QueryKey } from "@tanstack/react-query";
import { Component, useContext, useState, type ReactNode } from "react";

import { ErrorState } from "@/shared/components/ErrorState";

const REPORTS_QUERY_KEY: QueryKey = ["reports"];

type BoundaryProps = {
  children: ReactNode;
  description: string;
  onRetry: () => void;
  /** Al cambiar, el límite se reinicia y vuelve a intentar pintar a sus hijos. */
  resetKey: string;
  title: string;
};

type BoundaryState = { hasError: boolean; resetKey: string };

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): BoundaryState | null {
    return props.resetKey === state.resetKey ? null : { hasError: false, resetKey: props.resetKey };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section
        className="min-w-0 rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm"
        data-testid="panel-error"
      >
        <ErrorState
          description={this.props.description}
          onRetry={this.props.onRetry}
          title={this.props.title}
        />
      </section>
    );
  }
}

type PanelErrorBoundaryProps = {
  children: ReactNode;
  description?: string;
  /**
   * Consultas que alimentan el panel (prefijo de su clave). «Reintentar» tira
   * las que el panel dejó huérfanas al caer y vuelve a pedir las que siguen
   * activas, para no repintar la misma respuesta rota.
   */
  queryKey?: QueryKey;
  /** Cambia cuando cambia lo que el panel pinta (reporte, filtros, datos): reinicia el límite. */
  resetKey?: string;
  title?: string;
};

/**
 * Límite de error de un panel (un reporte, una tarjeta del dashboard). Si su
 * render lanza —una respuesta 200 con campos nulos o de otro tipo— muestra el
 * `ErrorState` del tema con «Reintentar» y el resto de la página sigue viva.
 * React ya registra el error en la consola; aquí no se silencia nada.
 */
export function PanelErrorBoundary({
  children,
  description = "Los datos llegaron incompletos o con un formato inesperado.",
  queryKey = REPORTS_QUERY_KEY,
  resetKey = "",
  title = "No pudimos mostrar este reporte",
}: PanelErrorBoundaryProps) {
  // Sin proveedor (una prueba, un story) solo se reinicia el límite.
  const queryClient = useContext(QueryClientContext);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    queryClient?.removeQueries({ queryKey, type: "inactive" });
    void queryClient?.invalidateQueries({ queryKey });
    setAttempt((current) => current + 1);
  }

  return (
    <Boundary
      description={description}
      onRetry={retry}
      resetKey={`${attempt}:${resetKey}`}
      title={title}
    >
      {children}
    </Boundary>
  );
}
