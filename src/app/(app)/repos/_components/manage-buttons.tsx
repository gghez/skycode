"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { removeRepoAction, removeConnectionAction } from "../actions";
import { Button } from "@/components/ui/button";

export function RemoveRepoButton({ repoId }: { repoId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeRepoAction(repoId);
          router.refresh();
        })
      }
    >
      Retirer
    </Button>
  );
}

export function RemoveConnectionButton({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeConnectionAction(connectionId);
          router.refresh();
        })
      }
    >
      Supprimer la connexion
    </Button>
  );
}
