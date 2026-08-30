import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { credentialsRouter } from "./credentialsRouter";
import { agentsRouter } from "./agentsRouter";
import { callsRouter } from "./callsRouter";
import { messagesRouter, contactsRouter } from "./messagesRouter";
import { tenantsRouter } from "./tenantsRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  credentials: credentialsRouter,
  agents: agentsRouter,
  calls: callsRouter,
  messages: messagesRouter,
  contacts: contactsRouter,
  tenants: tenantsRouter,
});

export type AppRouter = typeof appRouter;
