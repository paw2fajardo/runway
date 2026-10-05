import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import {
  createPushSubscriptionHandlers,
  databasePushSubscriptionStore,
} from "../../../../lib/payday/push";

const handlers = createPushSubscriptionHandlers({
  authenticate: requireOwner,
  sameOrigin: assertSameOrigin,
  store: databasePushSubscriptionStore,
  publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
