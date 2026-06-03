import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import {
  createContact,
  listContacts,
  type ContactInput as ContactServerInput,
} from "../services/contacts.mock-server";

import { ContactsListPage } from "./page";

const meta = {
  component: ContactsListPage,
  parameters: {
    msw: {
      handlers: [
        http.get("/api/contacts", ({ request }) =>
          HttpResponse.json({
            data: listContacts(new URL(request.url).searchParams),
          }),
        ),
        http.post("/api/contacts", async ({ request }) =>
          HttpResponse.json(
            { data: createContact((await request.json()) as ContactServerInput) },
            { status: 201 },
          ),
        ),
      ],
    },
  },
  title: "Modules/Contacts/ContactsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ContactsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
