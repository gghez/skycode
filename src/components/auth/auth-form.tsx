"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth-client";
import { validateCredentials, type CredentialErrors } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Connexion",
    description: "Connectez-vous à votre compte",
    submit: "Se connecter",
    switchText: "Pas de compte ?",
    switchCta: "Créer un compte",
    switchHref: "/register",
  },
  register: {
    title: "Créer un compte",
    description: "Créez votre compte skycode",
    submit: "Créer le compte",
    switchText: "Déjà un compte ?",
    switchCta: "Se connecter",
    switchHref: "/login",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const validation = validateCredentials(email, password);
    setErrors(validation);
    if (validation.email || validation.password) return;

    setLoading(true);
    const result =
      mode === "register"
        ? await signUp.email({ email, password, name: email.split("@")[0] })
        : await signIn.email({ email, password });
    setLoading(false);

    if (result.error) {
      setFormError(
        mode === "register"
          ? "Impossible de créer le compte (email déjà utilisé ?)"
          : "Identifiants invalides",
      );
      return;
    }
    router.push("/repos");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
            {errors.password && <p className="text-sm text-red-600">{errors.password}</p>}
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "…" : copy.submit}
          </Button>
          <p className="text-sm text-muted-foreground">
            {copy.switchText}{" "}
            <Link href={copy.switchHref} className="underline text-foreground">
              {copy.switchCta}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
