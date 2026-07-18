"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { listUntrackedProjectsAction, activateReposAction } from "../actions";
import type { DiscoveredProject } from "@/lib/repos/service";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function AddRepoDialog({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function onOpenChange(o: boolean) {
    setOpen(o);
    setError(null);
    setSelected(new Set());
    if (o) {
      setLoading(true);
      const result = await listUntrackedProjectsAction(connectionId);
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setProjects([]);
        return;
      }
      setProjects(result.data);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConfirm() {
    setLoading(true);
    const result = await activateReposAction(connectionId, [...selected]);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Ajouter un repo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un repo</DialogTitle>
          <DialogDescription>Projets du groupe non encore suivis.</DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <p className="text-sm text-muted-foreground">Tous les projets sont déjà suivis.</p>
        )}
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {projects.map((p) => (
            <li key={p.gitlabProjectId} className="flex items-center gap-2">
              <input
                id={`ap-${p.gitlabProjectId}`}
                type="checkbox"
                checked={selected.has(p.gitlabProjectId)}
                onChange={() => toggle(p.gitlabProjectId)}
              />
              <label htmlFor={`ap-${p.gitlabProjectId}`} className="text-sm">
                {p.pathWithNamespace}
              </label>
            </li>
          ))}
        </ul>
        {projects.length > 0 && (
          <Button className="mt-4 w-full" disabled={loading || selected.size === 0} onClick={onConfirm}>
            {loading ? "…" : `Activer ${selected.size} projet(s)`}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
