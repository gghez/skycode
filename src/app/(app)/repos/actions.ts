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
  await removeRepo(organizationId, repoId);
  revalidatePath("/repos");
  return { ok: true, data: null };
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
