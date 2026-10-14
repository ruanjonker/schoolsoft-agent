import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getMessage = defineOperation({
  name: "get_message",
  title: "Get one message",
  description: `Get the full body of one inbox message.

Args:
  - id (number): Message id from get_messages.
  - child_id (number, optional): selects the school.

Returns: { message: { id, subject, sender, sentAt, body, read, attachments } }.

This is a GET. The client never sends a separate "mark as read". If the portal
marks a message read as a side effect of loading it, that has not been
re-checked; use get_messages when the unread flag is enough.

Use when: the user wants to read a specific message listed by get_messages.`,
  input: { id: z.number().int().describe("Message id from get_messages"), child_id: ChildSchema },
  portal: ["getMessage"],
  annotations: READ_ONLY,
  async run(ctx, { id, child_id }) {
    const { guardian, orgId } = await withChild(ctx, child_id);
    const message = await ctx.portal.getMessage(guardian.userId, orgId, id);
    return { message };
  },
});
