# Contexto global — prefijo para prompts Stitch

Pegar al inicio de cada prompt (o referenciar en el texto).

## Bloque

```
Producto: Control Ventas ERP (marca BodegaSync). ERP retail Venezuela/LATAM.
Moneda: precios en REF; totales también en VES con tasa REF/VES del día (snapshot en facturas).
Design system Stitch existente: Inter, primary indigo #4F46E5, secondary emerald #10B981, warning amber #F59E0B, surface #F8F9FF, sidebar 288px desktop, bordes suaves 4px, densidad alta tipo SaaS ERP.
Layout autenticado: sidebar oscuro slate-900 (Inicio, Ventas, Compras, Inventario, Productos, Contactos, Pagos, Reportes, Configuración). Header sticky: tasa REF/VES, toggle tema, usuario, cerrar sesión. Móvil: hamburger + drawer navegación.
Componentes: tablas paginadas densas, FilterPanel colapsable, badges de estado, cards KPI, modales centrados (móvil tipo sheet), empty/error/loading states.
Idioma UI: español (Venezuela). Iconos estilo Lucide 20px.
Breakpoints: móvil <768 (1 col, drawer), tablet 768–1024, desktop >1024 (sidebar fijo 12 cols).
No inventar módulos fuera de esta lista.
```

Ver también: [`01-inventario-maestro-prompts.md`](01-inventario-maestro-prompts.md)
