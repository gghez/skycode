"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addConnectionAction, activateReposAction } from "../actions";
import type { DiscoveredProject } from "@/lib/repos/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type GroupStep = { connectionId: string; projects: DiscoveredProject[] };

export function AddConnectionDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState("https://gitlab.com");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupStep | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function reset() {
    setInstanceUrl("https://gitlab.com");
    setToken("");
    setError(null);
    setGroup(null);
    setSelected(new Set());
  }

  async function onSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await addConnectionAction({ instanceUrl, token });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.scopeType === "project") {
      setOpen(false);
      reset();
      router.refresh();
      return;
    }
    setGroup({ connectionId: result.data.connectionId, projects: result.data.projects });
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConfirmGroup() {
    if (!group) return;
    setError(null);
    setLoading(true);
    const result = await activateReposAction(group.connectionId, [...selected]);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Ajouter une connexion</Button>
      </DialogTrigger>
      <DialogContent>
        {!group ? (
          <form onSubmit={onSubmitToken}>
            <DialogHeader>
              <DialogTitle>Ajouter une connexion GitLab</DialogTitle>
              <DialogDescription>
                Collez un token d&apos;accès de projet ou de groupe. Son identité bot postera les
                commentaires et fusions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="instanceUrl">URL de l&apos;instance</Label>
                <Input
                  id="instanceUrl"
                  value={instanceUrl}
                  onChange={(e) => setInstanceUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token">Access token</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || !token}>
                {loading ? "…" : "Valider"}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <DialogHeader>
              <DialogTitle>Sélectionner les projets</DialogTitle>
              <DialogDescription>
                Cochez les projets du groupe que skycode doit suivre.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {group.projects.map((p) => (
                <li key={p.gitlabProjectId} className="flex items-center gap-2">
                  <input
                    id={`p-${p.gitlabProjectId}`}
                    type="checkbox"
                    disabled={p.alreadyTracked}
                    checked={p.alreadyTracked || selected.has(p.gitlabProjectId)}
                    onChange={() => toggle(p.gitlabProjectId)}
                  />
                  <label htmlFor={`p-${p.gitlabProjectId}`} className="text-sm">
                    {p.pathWithNamespace}
                    {p.alreadyTracked && (
                      <span className="ml-2 text-xs text-muted-foreground">(déjà suivi)</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <Button
              className="mt-4 w-full"
              disabled={loading || selected.size === 0}
              onClick={onConfirmGroup}
            >
              {loading ? "…" : `Activer ${selected.size} projet(s)`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
