import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPrimaryOrganizationId } from "@/lib/organization";

export interface OrgContext {
  userId: string;
  organizationId: string;
}

export async function requireActiveOrganization(): Promise<OrgContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const organizationId =
    session.session.activeOrganizationId ?? (await getPrimaryOrganizationId(session.user.id));
  if (!organizationId) throw new Error("No active organization for the current user");
  return { userId: session.user.id, organizationId };
}
