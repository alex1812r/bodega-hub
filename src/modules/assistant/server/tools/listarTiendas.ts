import { z } from "zod";

import { listAssistantStores } from "../storeRefs";
import { registerTool } from "../toolRegistry";

import { clampList, ok } from "./_shared";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

export const listarTiendas = registerTool<Input>({
  description:
    "Lista las tiendas de la plataforma con su nombre, slug y si estan activas. Usala para saber que tiendas existen antes de comparar.",
  examples: [
    "cuantas tiendas hay activas",
    "que tiendas existen",
    "dame la lista de tiendas",
  ],
  inputSchema,
  name: "listar_tiendas",
  scope: "platform",
  execute: async () => {
    const stores = await listAssistantStores();
    const { items, note } = clampList(stores, 20, stores.length);

    return ok(
      "listar_tiendas",
      {
        activas: stores.filter((store) => store.isActive).length,
        tiendas: items.map((store) => ({
          activa: store.isActive,
          id: store.id,
          nombre: store.name,
          slug: store.slug,
        })),
        total: stores.length,
      },
      { note: stores.length === 0 ? "No hay tiendas registradas." : note },
    );
  },
});
