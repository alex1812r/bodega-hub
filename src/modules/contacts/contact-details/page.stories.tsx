import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import {
  type ContactInput as ContactServerInput,
  getContactActivity,
  getContactById,
  updateContact,
} from "../services/contacts.mock-server";

import { ContactDetailsPage } from "./page";

const meta = {
  component: ContactDetailsPage,
  parameters: {
    msw: {
      handlers: [
        http.get("/api/contacts/:id", ({ params }) =>
          HttpResponse.json({ data: getContactById(String(params.id)) }),
        ),
        http.patch("/api/contacts/:id", async ({ params, request }) =>
          HttpResponse.json({
            data: updateContact(
              String(params.id),
              (await request.json()) as ContactServerInput,
            ),
          }),
        ),
        http.get("/api/contacts/:id/activity", ({ params }) =>
          HttpResponse.json({
            data: getContactActivity(String(params.id), new URLSearchParams()),
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
