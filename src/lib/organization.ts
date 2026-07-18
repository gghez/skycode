import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
