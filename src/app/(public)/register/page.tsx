import { AuthForm } from "@/components/auth/auth-form";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <AuthForm mode="register" />
    </main>
  );
}
