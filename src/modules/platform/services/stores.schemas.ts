import { z } from "zod";

const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa minúsculas, números y guiones.");

export const createStoreSchema = z.object({
  admin: z.object({
    email: z.email(),
    fullName: z.string().trim().min(2).max(120),
    password: z.string().min(8).max(128),
    sendCredentialsEmail: z.boolean().optional(),
  }),
  name: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1000).optional(),
  slug: slugSchema,
  status: z.enum(["active", "paused"]).optional(),
});

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    slug: slugSchema.optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "Indica al menos un cambio.");
