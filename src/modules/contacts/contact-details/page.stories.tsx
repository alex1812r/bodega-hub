import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import {
  type ContactInput as ContactServerInput,
  getContactActivity,
  getContactById,
  getContactPayments,
  getContactPurchases,
  getContactSales,
  updateContact,
} from "../services/contacts.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { ContactDetailsPage } from "./page";

const meta = {
  component: ContactDetailsPage,
  parameters: {
    msw: {
      handlers: [
        http.get("/api/contacts/:id", ({ params }) =>
          HttpResponse.json({ data: getContactById(String(params.id), DEFAULT_STORE_ID) }),
        ),
        http.patch("/api/contacts/:id", async ({ params, request }) =>
          HttpResponse.json({
            data: updateContact(
              String(params.id),
              (await request.json()) as ContactServerInput,
              DEFAULT_STORE_ID,
            ),
          }),
        ),
        // Con los parámetros de la petición: las pestañas paginan en servidor (`skip`/`limit`).
        http.get("/api/contacts/:id/activity", ({ params, request }) =>
          HttpResponse.json({
            data: getContactActivity(
              String(params.id),
              new URL(request.url).searchParams,
              DEFAULT_STORE_ID,
            ),
          }),
        ),
        http.get("/api/contacts/:id/sales", ({ params, request }) =>
          HttpResponse.json({
            data: getContactSales(
              String(params.id),
              new URL(request.url).searchParams,
              DEFAULT_STORE_ID,
            ),
          }),
        ),
        http.get("/api/contacts/:id/purchases", ({ params, request }) =>
          HttpResponse.json({
            data: getContactPurchases(
              String(params.id),
              new URL(request.url).searchParams,
              DEFAULT_STORE_ID,
            ),
          }),
        ),
        http.get("/api/contacts/:id/payments", ({ params, request }) =>
          HttpResponse.json({
            data: getContactPayments(
              String(params.id),
              new URL(request.url).searchParams,
              DEFAULT_STORE_ID,
            ),
          }),
        ),
      ],
    },
  },
  title: "Modules/Contacts/ContactDetailsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ContactDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
