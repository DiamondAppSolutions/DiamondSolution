import { serviceClient } from "./supabaseClients.ts";

type NotificationType =
  | "payment_success"
  | "payment_failed"
  | "commission_earned"
  | "withdrawal_processed";

// Best-effort: a notification row failing to insert should never fail the underlying
// payment/payout it's describing, so errors here are swallowed, not thrown.
export async function notify(args: {
  db?: ReturnType<typeof serviceClient>;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
}) {
  const db = args.db ?? serviceClient();
  const { error } = await db.from("notifications").insert({
    user_id: args.userId,
    type: args.type,
    title: args.title,
    body: args.body,
  });
  if (error)
    console.error("[notify] failed to insert notification:", error.message);
}
