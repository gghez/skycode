import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensurePersonalOrganization, getPrimaryOrganizationId } from "@/lib/organization";

export interface OrgContext {
  userId: string;
  organizationId: string;
}

export async function requireActiveOrganization(): Promise<OrgContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  // better-auth defers the signup `user.create.after` hook until after the
  // request handler returns, so a user's very first session is always
  // created with a null `activeOrganizationId`. Fall back to a lookup, and
  // finally to a self-healing creation, so callers never fail just because
  // that hook hasn't run (or never ran) yet.
  const organizationId =
    session.session.activeOrganizationId ??
    (await getPrimaryOrganizationId(session.user.id)) ??
    (await ensurePersonalOrganization(session.user.id, "Espace personnel"));
  return { userId: session.user.id, organizationId };
}
