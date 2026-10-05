import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../../db";
import { ownerAuth } from "../../db/schema";
import { getOwnerFromRequest } from "../../lib/auth/session";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const owner = await getOwnerFromRequest(
    new Request("http://runway.local/", { headers: { cookie } }),
  );

  if (!owner) {
    const [configuredOwner] = await db
      .select({ id: ownerAuth.id })
      .from(ownerAuth)
      .limit(1);
    redirect(configuredOwner ? "/login" : "/setup");
  }

  return children;
}
