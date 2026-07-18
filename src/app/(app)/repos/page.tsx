import { requireActiveOrganization } from "@/lib/repos/context";
import { listConnectionsWithRepos } from "@/lib/repos/service";
import { AddConnectionDialog } from "./_components/add-connection-dialog";
import { AddRepoDialog } from "./_components/add-repo-dialog";
import { RemoveRepoButton, RemoveConnectionButton } from "./_components/manage-buttons";

export default async function ReposPage() {
  const { organizationId } = await requireActiveOrganization();
  const connections = await listConnectionsWithRepos(organizationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Repos</h1>
        <AddConnectionDialog />
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <p className="font-medium">Aucun repo pour l&apos;instant</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajoutez une connexion GitLab pour suivre des projets.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {connections.map((c) => (
            <section key={c.id} className="rounded-lg border">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div className="text-sm">
                  <span className="font-medium">@{c.botUsername}</span>{" "}
                  <span className="text-muted-foreground">
                    · {c.scopeType} · {c.instanceUrl}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {c.scopeType === "group" && <AddRepoDialog connectionId={c.id} />}
                  <RemoveConnectionButton connectionId={c.id} />
                </div>
              </header>
              {c.repos.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Aucun projet suivi.</p>
              ) : (
                <ul className="divide-y">
                  {c.repos.map((r) => (
                    <li key={r.id} className="flex items-center justify-between px-4 py-3">
                      <a
                        href={r.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        {r.pathWithNamespace}
                      </a>
                      <RemoveRepoButton repoId={r.id} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
