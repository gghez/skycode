import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { AccountMenu } from "@/components/shell/account-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b px-6 py-3">
          <AccountMenu email={session.user.email} />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
