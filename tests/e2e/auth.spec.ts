import { test, expect } from "@playwright/test";

test("register, land on repos, sign out, sign in", async ({ page }) => {
  const email = `user_${Date.now()}@example.com`;
  const password = "password123";

  // Register
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer le compte" }).click();

  // Lands on the protected repos page (empty state)
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByText("Aucun repo pour l'instant")).toBeVisible();

  // Account menu shows the email
  await page.getByRole("button", { name: "Compte" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Sign out
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Sign in again
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/repos$/);
});

test("blocks access to protected area without a session", async ({ page }) => {
  await page.goto("/repos");
  await expect(page).toHaveURL(/\/login$/);
});

test("rejects a too-short password with an inline error", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Email").fill(`user_${Date.now()}@example.com`);
  await page.getByLabel("Mot de passe").fill("short");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(
    page.getByText("Le mot de passe doit contenir au moins 8 caractères"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});
