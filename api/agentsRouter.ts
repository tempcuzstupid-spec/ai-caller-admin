import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agents } from "@db/schema";
import { AGENT_CATEGORIES } from "@contracts/catalog";

const agentInput = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(["inbound_support", "outbound_sales", "appointment_reminder", "personal_assistant", "custom"]),
  direction: z.enum(["inbound", "outbound", "both"]),
  systemPrompt: z.string().min(1).max(20000),
  openingLine: z.string().max(2000).optional().nullable(),
  voiceId: z.string().max(64).default("TxGEqnHWrfWFTfGW9XjX"),
  model: z.string().max(64).default("gpt-4o-mini"),
  active: z.boolean().default(true),
});

export const agentsRouter = createRouter({
  templates: authedQuery.query(() => AGENT_CATEGORIES),

  list: authedQuery.query(async ({ ctx }) => {
    return getDb().query.agents.findMany({
      where: eq(agents.userId, ctx.user.id),
      orderBy: [desc(agents.updatedAt)],
    });
  }),

  get: authedQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const row = await getDb().query.agents.findFirst({
      where: and(eq(agents.id, input.id), eq(agents.userId, ctx.user.id)),
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    return row;
  }),

  create: authedQuery.input(agentInput).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const r = await db.insert(agents).values({ ...input, userId: ctx.user.id });
    return { id: Number(r[0].insertId) };
  }),

  update: authedQuery
    .input(z.object({ id: z.number(), data: agentInput.partial() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const res = await db
        .update(agents)
        .set(input.data)
        .where(and(eq(agents.id, input.id), eq(agents.userId, ctx.user.id)));
      if ((res[0] as any).affectedRows === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true };
    }),

  remove: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const res = await getDb()
      .delete(agents)
      .where(and(eq(agents.id, input.id), eq(agents.userId, ctx.user.id)));
    if ((res[0] as any).affectedRows === 0) throw new TRPCError({ code: "NOT_FOUND" });
    return { ok: true };
  }),
});
