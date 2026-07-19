import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ensurePersonalOrganization, getPrimaryOrganizationId } from "@/lib/organization";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensurePersonalOrganization(user.id, "Espace personnel");
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const organizationId = await getPrimaryOrganizationId(session.userId);
          return { data: { ...session, activeOrganizationId: organizationId } };
        },
      },
    },
  },
  plugins: [
    // This slice only needs a personal organization per user (created directly via
    // ensurePersonalOrganization above, not through this plugin's endpoints). Team
    // management (invitations, roles) is deferred to a future "Teams" slice, so the
    // out-of-scope surface this plugin otherwise exposes is narrowed here: users can't
    // create additional organizations through /organization/create, and organizations
    // can't be cascade-deleted through /organization/delete.
    organization({
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
    }),
    // nextCookies must be the last plugin so it can set cookies from server actions.
    nextCookies(),
  ],
});
