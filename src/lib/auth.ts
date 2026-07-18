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
    organization(),
    // nextCookies must be the last plugin so it can set cookies from server actions.
    nextCookies(),
  ],
});
