import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { expect } from "storybook/test";

import { NumberInput } from "./NumberInput";

const usageGuide = `
Campo numérico de la app. Es un \`type="text"\` con teclado numérico: la rueda del ratón y las flechas
no cambian el valor, se selecciona todo al enfocar, acepta coma o punto y el valor del DOM siempre
lleva punto decimal. Al salir (o al pulsar Enter) redondea a \`decimals\`, aplica \`min\`/\`max\` y limpia el formato.

**Decimales**: mientras se teclea o se pega se conservan los decimales de más; al salir del campo se
redondean a \`decimals\`, medio hacia arriba y sin errores de coma flotante (\`12.345\` → \`12.35\`,
\`1.005\` → \`1.01\`, \`0.999\` → \`1\`), y \`onChange\`/\`onValueChange\`/\`register\` reciben el valor final.
Hasta ese momento \`onChange\` puede traer más decimales: no construyas el payload antes del blur.

**Enteros (\`decimals={0}\`)**: el campo nunca cambia la cantidad por su cuenta. Si se teclea o se pega
\`2.5\` se ve \`2.5\` (no \`25\` ni \`3\`), el campo queda inválido (\`aria-invalid\` y el mensaje
"Debe ser un número entero." bajo el campo, salvo que le pases tu propio \`error\`) y al salir o pulsar
Enter se queda igual; \`2.0\` y \`2,\` sí se limpian a \`2\`. \`onChange\`/\`onValueChange\`/\`register\`
reciben \`2.5\`: **el formulario debe negarse a enviar** (\`Number.isInteger\` sobre el número, o
\`isIntegerText(texto)\` / \`getNumberInputError(texto, { decimals: 0 })\` sobre el texto, exportados
junto al componente).

**Qué modo usar**

- **\`register\` de react-hook-form** (no controlado): \`<NumberInput {...register("price", { valueAsNumber: true })} />\`.
  Si el campo puede quedar vacío usa \`{ setValueAs: parseNumberInput }\` para recibir \`null\` en vez de \`NaN\`.
- **\`Controller\`**: \`value={field.value}\`, \`onValueChange={field.onChange}\`, \`onBlur={field.onBlur}\`,
  \`ref={field.ref}\`, \`name={field.name}\`. El formulario guarda \`number | null\`.
- **Estado local con texto** (\`useState("")\`): se deja igual, \`value={amount}\` y
  \`onChange={(event) => setAmount(event.target.value)}\`. El texto llega ya limpio y con punto.
- **Estado local con número**: \`value={quantity}\` y \`onValueChange={(next) => setQuantity(next ?? 0)}\`.
  El \`onChange\` con \`Number(event.target.value)\` que ya exista también sigue funcionando.

**Pegado**: con coma y punto, el último es el decimal (\`1.234,50\` y \`1,234.50\` → \`1234.50\`); un mismo
separador repetido son miles (\`1.234.567\` → \`1234567\`); un único separador es siempre decimal
(\`1.234\` → \`1.234\`). Un espacio seguido de tres dígitos son miles (\`1 000\` → \`1000\`) y lo que rodea
al número se ignora (\`Bs 12\` → \`12\`). Si entre los dígitos hay otra cosa (\`1e3\`, \`12abc3\`, \`10 20\`)
el pegado se rechaza entero y el campo se queda como estaba: no se unen los dígitos (\`1e3\` no es \`13\`).
Al teclear, cada tecla que no es numérica se rechaza en el momento.

**Separadores al teclear**: un único separador es siempre el decimal (\`1.234\` vale 1,234). Si llega un segundo:

- **distinto** del que ya hay (hay punto y se teclea coma, o al revés): igual que al pegar, el último del
  texto es el decimal y el anterior pasa a ser de miles y se quita. Teclear \`1.250,75\` o \`1,250.75\` va
  dejando \`1.\` → \`1.250\` → \`1250.\` → \`1250.75\`. Con \`1250.75\` en el campo, una coma tecleada antes del
  punto se descarta y el valor no cambia.
- **igual** al que ya hay (\`1.250\` y otro punto): la tecla se rechaza, el valor y el cursor no se mueven.
  No se reinterpreta como miles: \`1.250.75\` tecleado deja \`1.25075\`.

El campo recuerda con qué tecla se escribió el separador mientras se edita; al salir, pegar o usar las
flechas cuenta como el punto que se ve. Lo que muestra el campo y lo que reciben
\`onChange\`/\`onValueChange\`/\`register\` coinciden en cada pulsación. Con \`decimals={0}\` valen las
mismas reglas: el separador se conserva y el campo queda inválido.

\`step\` solo actúa con \`allowArrowStep\`. Sin \`allowNegative\` el campo nunca baja de cero.
`;

const meta = {
  component: NumberInput,
  tags: ["ai-generated"],
  args: {
    label: "Cantidad",
    placeholder: "0",
  },
  parameters: {
    docs: {
      description: {
        component: usageGuide,
      },
    },
  },
} satisfies Meta<typeof NumberInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText(/cantidad/i);

    await userEvent.type(field, "12,5");

    await expect(field).toHaveValue("12.5");
    await expect(field).toHaveAttribute("type", "text");
  },
};

export const Currency: Story = {
  args: {
    decimals: 2,
    defaultValue: 12.5,
    helperText: "Dos decimales; al salir se completa con ceros.",
    label: "Monto REF",
    padDecimals: true,
  },
};

export const Integer: Story = {
  args: {
    decimals: 0,
    defaultValue: 24,
    helperText: "Sin decimales: abre el teclado numérico.",
    label: "Unidades por empaque",
  },
};

export const IntegerWithDecimals: Story = {
  args: {
    decimals: 0,
    helperText: "Sin decimales: abre el teclado numérico.",
    label: "Cantidad a ajustar",
  },
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText(/cantidad a ajustar/i);

    await userEvent.type(field, "2.5");
    await userEvent.tab();

    await expect(field).toHaveValue("2.5");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByText("Debe ser un número entero.")).toBeVisible();
  },
};

export const WithMinMax: Story = {
  args: {
    decimals: 2,
    defaultValue: 16,
    helperText: "Entre 0 y 100. Se ajusta al salir del campo.",
    label: "Porcentaje",
    max: 100,
    min: 0,
  },
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText(/porcentaje/i);

    await userEvent.type(field, "250");
    await userEvent.tab();

    await expect(field).toHaveValue("100");
  },
};

export const WithArrowStep: Story = {
  args: {
    allowArrowStep: true,
    decimals: 0,
    defaultValue: 1,
    helperText: "Las flechas arriba y abajo suman o restan una unidad.",
    min: 1,
    step: 1,
  },
};

export const WithError: Story = {
  args: {
    error: "El monto es obligatorio.",
    label: "Monto Bs",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText(/monto bs/i)).toHaveAttribute("aria-invalid", "true");
  },
};

export const Disabled: Story = {
  args: {
    defaultValue: 150,
    disabled: true,
    label: "Saldo inicial",
  },
};

export const ReadOnly: Story = {
  args: {
    defaultValue: 150,
    label: "Saldo calculado",
    readOnly: true,
  },
};

function ControlledExample() {
  const [quantity, setQuantity] = useState<number | null>(3);

  return (
    <div className="space-y-3">
      <NumberInput
        decimals={0}
        label="Cantidad"
        min={1}
        onValueChange={setQuantity}
        value={quantity}
      />
      <p className="text-sm text-on-surface-variant">
        Valor en el estado: {quantity === null ? "vacío" : quantity}
      </p>
    </div>
  );
}

export const Controlled: Story = {
  render: () => <ControlledExample />,
};

function RegisterExample() {
  const { control, register } = useForm<{ price: number }>({ defaultValues: { price: 4.75 } });
  const price = useWatch({ control, name: "price" });

  return (
    <div className="space-y-3">
      <NumberInput
        decimals={2}
        label="Precio REF"
        {...register("price", { valueAsNumber: true })}
      />
      <p className="text-sm text-on-surface-variant">
        Valor en el formulario: {Number.isNaN(price) ? "vacío" : price}
      </p>
    </div>
  );
}

export const WithReactHookFormRegister: Story = {
  render: () => <RegisterExample />,
};
