export type CredentialErrors = { email?: string; password?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors better-auth's minPasswordLength (8). Keep both in sync.
export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {};
  if (!EMAIL_RE.test(email)) errors.email = "Adresse email invalide";
  if (password.length < 8) errors.password = "Le mot de passe doit contenir au moins 8 caractères";
  return errors;
}
