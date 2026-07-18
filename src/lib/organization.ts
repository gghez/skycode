import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, organization } from "@/db/schema";

export async function createPersonalOrganization(userId: string, name: string): Promise<string> {
  const orgId = randomUUID();
  await db.insert(organization).values({ id: orgId, name, slug: `personal-${userId}` });
  await db.insert(member).values({ id: randomUUID(), organizationId: orgId, userId, role: "owner" });
  return orgId;
}

export async function getPrimaryOrganizationId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

/**
 * Idempotently returns the user's personal organization id, creating it if
 * missing. Safe to call concurrently for the same brand-new user: a
 * transaction-scoped advisory lock keyed on the user id serializes competing
 * callers of this function, so exactly one of them creates the organization
 * and member row while the rest observe it via the membership lookup. The
 * deterministic `personal-${userId}` slug (unique in the schema) is also
 * guarded with `onConflictDoNothing` as a defense-in-depth measure for the
 * organization row specifically.
 */
export async function ensurePersonalOrganization(userId: string, name: string): Promise<string> {
  const slug = `personal-${userId}`;

  return db.transaction(async (tx) => {
    // Serialize concurrent callers for the same user. The lock is
    // transaction-scoped and released automatically on commit/rollback.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const existingMembership = await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1);
    if (existingMembership[0]) {
      return existingMembership[0].organizationId;
    }

    const [inserted] = await tx
      .insert(organization)
      .values({ id: randomUUID(), name, slug })
      .onConflictDoNothing({ target: organization.slug })
      .returning({ id: organization.id });

    const orgId =
      inserted?.id ??
      (
        await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.slug, slug))
          .limit(1)
      )[0]?.id;

    if (!orgId) {
      throw new Error(`Failed to resolve personal organization for user ${userId}`);
    }

    await tx
      .insert(member)
      .values({ id: randomUUID(), organizationId: orgId, userId, role: "owner" })
      .onConflictDoNothing();

    return orgId;
  });
}
