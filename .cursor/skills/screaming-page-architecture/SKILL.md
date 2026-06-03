---
name: screaming-page-architecture
description: Apply the project's screaming architecture with page-scoped folders inside feature modules. Use when creating, refactoring, reviewing, or organizing modules, pages, components, hooks, services, or frontend feature structure.
---

# Screaming Page Architecture

## Principle

Use screaming architecture: the folder structure must reveal the business domain first. A developer should understand the app by seeing modules like `sales`, `purchases`, `inventory`, `products`, `customers`, `suppliers`, and `payments`, not generic technical folders.

This project uses a page-scoped variation:

```text
modules/
  orders/
    orders-list/
    order-details/
```

Do not use a generic pattern like:

```text
modules/
  orders/
    pages/
      orders-list/
      order-details/
```

Each page gets its own folder directly inside the module.

## Module Structure

Use this shape for each business module:

```text
src/
  modules/
    orders/
      orders-list/
        page.tsx
        components/
        hooks/
        services/
        schemas/
        types.ts
      order-details/
        page.tsx
        components/
        hooks/
        services/
        schemas/
        types.ts
      components/
      hooks/
      services/
      schemas/
      types.ts
```

Use the module-level folders only for code shared by two or more pages inside that module.

## Placement Rules

Place code as close as possible to where it is used.

If a component, hook, schema, helper, or service is used only by one page:

```text
modules/orders/orders-list/components/OrdersTable.tsx
modules/orders/orders-list/hooks/useOrdersList.ts
```

If it is shared only within the same module:

```text
modules/orders/components/OrderStatusBadge.tsx
modules/orders/hooks/useOrderTotals.ts
```

If it is shared across multiple modules:

```text
src/shared/components/
src/shared/hooks/
src/shared/services/
src/shared/schemas/
src/shared/types/
src/shared/utils/
```

Do not place page-private code in `shared`.
Do not promote code to module-level or shared folders until there is real reuse.

## SOLID and Reuse Rules

Apply SOLID as much as practical, especially single responsibility and dependency direction.

*   Each component should have one clear responsibility.
*   Keep page components focused on composition, not business logic.
*   Move data fetching, mutations, calculations, validation, and formatting into hooks, services, schemas, or utils.
*   Prefer small components that receive explicit props over large components that know too much.
*   Do not duplicate UI primitives. If a `Button`, `Input`, `Select`, `Modal`, `Table`, or `Badge` already exists in `shared/components`, reuse it.
*   Do not create a new button variant as a new component unless the existing shared `Button` cannot support it through props or variants.
*   Centralize reusable UI primitives in `shared/components`.
*   Centralize shared formatting helpers in `shared/utils`.
*   Centralize shared hooks in `shared/hooks`.
*   Centralize shared API/query functions in `shared/services` only when used across modules.
*   Keep module-specific abstractions inside the module, not in `shared`.
*   Extract duplicated behavior only after there is real duplication or an obvious shared primitive.
*   Shared components should have Storybook stories that document variants and states.
*   Interactive or business-critical components should have React Testing Library tests.
*   Use Storybook to validate reusable UI visually before duplicating or creating alternatives.

Before creating a new component, check:

1. Does a shared component already solve this?
2. Is this just a variant of an existing component?
3. Is this page-only, module-only, or app-wide?
4. Can this responsibility be delegated to a hook, service, schema, or utility?
5. Does a shared component need a story or test before it is reused broadly?

Prefer composition:

```tsx
<Button variant="primary" size="sm">Guardar</Button>
```

Avoid unnecessary duplication:

```tsx
<SaveButton />
<PrimarySaveButton />
<BlueActionButton />
```

## Page Folder Rules

Each page folder should represent a user-facing screen or route:

```text
sales/
  sales-list/
  sale-create/
  sale-details/
```

Recommended page folder names:

*   Use kebab-case.
*   Use business language.
*   Prefer `sales-list`, `sale-create`, `sale-details`, `purchase-details`, `inventory-adjustments`.
*   Avoid vague names like `main`, `view`, `screen`, `index`, or `page-one`.

## File Naming

Use PascalCase for React components:

```text
SaleItemsTable.tsx
PaymentMethodFields.tsx
StockMovementTimeline.tsx
```

Use camelCase for hooks, utilities, and services:

```text
useSalePayments.ts
calculateSaleTotals.ts
createSale.ts
```

Use `types.ts` for page-local or module-local types when the file is small. Split into named type files only when the type surface grows.

## Imports

Prefer local imports for page-owned code:

```ts
import { SaleItemsTable } from "./components/SaleItemsTable";
```

Use module imports for module-shared code:

```ts
import { SaleStatusBadge } from "../components/SaleStatusBadge";
```

Use shared imports only for cross-module code:

```ts
import { Button } from "@/shared/components/Button";
```

Avoid importing from another page folder. If `sale-details` needs something from `sale-create`, move that code up to `sales/components`, `sales/hooks`, or `sales/services`.

## ERP Module Names

Prefer these module names for this ERP:

```text
modules/
  sales/
  purchases/
  inventory/
  products/
  contacts/
  payments/
  reports/
  auth/
  settings/
```

Use `contacts` for shared client/provider management unless the product later needs separate `customers` and `suppliers` modules.

## Sales Module Example

```text
src/modules/sales/
  sales-list/
    page.tsx
    components/
      SalesFilters.tsx
      SalesTable.tsx
    hooks/
      useSalesList.ts
  sale-create/
    page.tsx
    components/
      SaleCart.tsx
      SaleTotals.tsx
      SalePaymentForm.tsx
      PaymentMethodFields.tsx
    hooks/
      useSaleDraft.ts
      useSalePayments.ts
    services/
      createSaleWithInitialPayment.ts
    schemas/
      saleCreateSchema.ts
  sale-details/
    page.tsx
    components/
      SaleItemsTable.tsx
      SalePaymentsTimeline.tsx
      SaleReceiptPreview.tsx
    hooks/
      useSaleDetails.ts
  components/
    SaleStatusBadge.tsx
    SaleTotalSummary.tsx
  services/
    registerSalePayment.ts
  types.ts
```

## Decision Checklist

Before creating a file, decide:

1. Is this used by only one page? Put it inside that page folder.
2. Is this used by multiple pages in the same module? Put it at module level.
3. Is this used by multiple modules? Put it in `shared`.
4. Is this business-specific? Keep it in the relevant module, not in generic app folders.
5. Is this UI primitive truly generic? Put it in `shared/components`.

When unsure, keep code page-local first. Promote only when reuse appears.
