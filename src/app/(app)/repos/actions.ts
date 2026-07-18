"use server";

import { revalidatePath } from "next/cache";
import { requireActiveOrganization } from "@/lib/repos/context";
import {
  addConnection,
  activateRepos,
  listUntrackedProjects,
  removeConnection,
  removeRepo,
  NotABotTokenError,
  ConnectionNotFoundError,
  InvalidInstanceUrlError,
  type AddConnectionResult,
  type DiscoveredProject,
} from "@/lib/repos/service";
import { GitlabAuthError, GitlabNotFoundError, GitlabUnavailableError } from "@/lib/gitlab/errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toMessage(e: unknown): string {
  if (e instanceof GitlabAuthError) return "Token invalide ou expiré.";
  if (e instanceof NotABotTokenError)
    return "Ce token n'est pas un token de projet ou de groupe (token personnel ?).";
  if (e instanceof GitlabNotFoundError) return "Projet ou groupe GitLab introuvable.";
  if (e instanceof GitlabUnavailableError) return "GitLab est injoignable pour le moment.";
  if (e instanceof ConnectionNotFoundError) return "Connexion introuvable.";
  if (e instanceof InvalidInstanceUrlError) return "URL d'instance GitLab invalide.";
  // Unexpected/unhandled error (e.g. missing config, DB constraint violation): log it
  // server-side so it's diagnosable, since the user only ever sees a generic message.
  // Only the error itself is logged here, never the action's input, so a plaintext
  // GitLab token (which lives in the input, not in these typed errors) can't leak.
  console.error("Unexpected error in repos action:", e);
  return "Une erreur inattendue est survenue.";
}

export async function addConnectionAction(
  input: { instanceUrl: string; token: string },
): Promise<ActionResult<AddConnectionResult>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    const data = await addConnection(organizationId, input);
    revalidatePath("/repos");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function activateReposAction(
  connectionId: string,
  gitlabProjectIds: number[],
): Promise<ActionResult<null>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    await activateRepos(organizationId, connectionId, gitlabProjectIds);
    revalidatePath("/repos");
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function listUntrackedProjectsAction(
  connectionId: string,
): Promise<ActionResult<DiscoveredProject[]>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    const data = await listUntrackedProjects(organizationId, connectionId);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function removeRepoAction(repoId: string): Promise<ActionResult<null>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    await removeRepo(organizationId, repoId);
    revalidatePath("/repos");
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function removeConnectionAction(connectionId: string): Promise<ActionResult<null>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    await removeConnection(organizationId, connectionId);
    revalidatePath("/repos");
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}
