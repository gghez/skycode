import { test, expect, type Page } from "@playwright/test";

const MOCK_URL = "http://localhost:4000";
const PASSWORD = "password123";

/** Registers a fresh user (unique email) and lands on the empty /repos page. */
async function registerAndLandOnRepos(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByText("Aucun repo pour l'instant")).toBeVisible();
  return email;
}

/** Opens "Ajouter une connexion", submits the token, and waits for the group step. */
async function openConnectionAndSubmitToken(page: Page, token: string): Promise<void> {
  await page.getByRole("button", { name: "Ajouter une connexion" }).click();
  await page.getByLabel("URL de l'instance").fill(MOCK_URL);
  await page.getByLabel("Access token").fill(token);
  await page.getByRole("button", { name: "Valider" }).click();
}

test("adds a group connection, selects both projects, then removes one repo", async ({ page }) => {
  await registerAndLandOnRepos(page, "e2e1");

  await openConnectionAndSubmitToken(page, "token-e2e-1");
  await expect(page.getByRole("heading", { name: "Sélectionner les projets" })).toBeVisible();

  await page.getByLabel("acme/backend").check();
  await page.getByLabel("acme/frontend").check();
  await page.getByRole("button", { name: "Activer 2 projet(s)" }).click();

  const backendLink = page.getByRole("link", { name: "acme/backend" });
  const frontendLink = page.getByRole("link", { name: "acme/frontend" });
  await expect(backendLink).toBeVisible();
  await expect(frontendLink).toBeVisible();
  await expect(backendLink).toHaveAttribute("href", "http://x/acme/backend");
  await expect(frontendLink).toHaveAttribute("href", "http://x/acme/frontend");

  const backendRow = page.locator("li").filter({ has: page.getByRole("link", { name: "acme/backend" }) });
  await backendRow.getByRole("button", { name: "Retirer" }).click();

  await expect(page.getByRole("link", { name: "acme/backend" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "acme/frontend" })).toBeVisible();
});

test("re-adding the same group token does not duplicate the connection", async ({ page }) => {
  await registerAndLandOnRepos(page, "e2e2");

  // First activation: only acme/backend.
  await openConnectionAndSubmitToken(page, "token-e2e-2");
  await expect(page.getByRole("heading", { name: "Sélectionner les projets" })).toBeVisible();
  await page.getByLabel("acme/backend").check();
  await page.getByRole("button", { name: "Activer 1 projet(s)" }).click();
  await expect(page.getByRole("link", { name: "acme/backend" })).toBeVisible();

  // Re-add the very same token.
  await openConnectionAndSubmitToken(page, "token-e2e-2");
  await expect(page.getByRole("heading", { name: "Sélectionner les projets" })).toBeVisible();

  const backendLabel = page
    .locator("label")
    .filter({ hasText: "acme/backend" })
    .filter({ hasText: "déjà suivi" });
  await expect(backendLabel).toBeVisible();

  const backendCheckbox = page.getByLabel("acme/backend");
  await expect(backendCheckbox).toBeDisabled();

  // Close the dialog without activating anything new.
  await page.keyboard.press("Escape");

  // Exactly one connection header for this bot, proving dedup (unique index),
  // not a second connection row.
  await expect(page.getByText("@group_42_bot_e2e")).toHaveCount(1);
});

test("adds a second repo later through the existing connection, without re-pasting a token", async ({
  page,
}) => {
  await registerAndLandOnRepos(page, "e2e3");

  await openConnectionAndSubmitToken(page, "token-e2e-3");
  await expect(page.getByRole("heading", { name: "Sélectionner les projets" })).toBeVisible();
  await page.getByLabel("acme/backend").check();
  await page.getByRole("button", { name: "Activer 1 projet(s)" }).click();
  await expect(page.getByRole("link", { name: "acme/backend" })).toBeVisible();
  await expect(page.getByRole("link", { name: "acme/frontend" })).toHaveCount(0);

  await page.getByRole("button", { name: "Ajouter un repo" }).click();
  await expect(page.getByRole("heading", { name: "Ajouter un repo" })).toBeVisible();
  const frontendOption = page.getByLabel("acme/frontend");
  await expect(frontendOption).toBeVisible();
  await frontendOption.check();
  await page.getByRole("button", { name: "Activer 1 projet(s)" }).click();

  await expect(page.getByRole("link", { name: "acme/backend" })).toBeVisible();
  await expect(page.getByRole("link", { name: "acme/frontend" })).toBeVisible();
});

test("removing a connection removes its repos", async ({ page }) => {
  await registerAndLandOnRepos(page, "e2e4");

  await openConnectionAndSubmitToken(page, "token-e2e-4");
  await expect(page.getByRole("heading", { name: "Sélectionner les projets" })).toBeVisible();
  await page.getByLabel("acme/backend").check();
  await page.getByRole("button", { name: "Activer 1 projet(s)" }).click();
  await expect(page.getByRole("link", { name: "acme/backend" })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer la connexion" }).click();

  await expect(page.getByText("@group_42_bot_e2e")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "acme/backend" })).toHaveCount(0);
  await expect(page.getByText("Aucun repo pour l'instant")).toBeVisible();
});

test("rejects a personal (non-bot) token with a clear message", async ({ page }) => {
  await registerAndLandOnRepos(page, "e2e5");

  await openConnectionAndSubmitToken(page, "personal");

  await expect(
    page.getByText("Ce token n'est pas un token de projet ou de groupe (token personnel ?)."),
  ).toBeVisible();
  // Did not advance to the group-selection step.
  await expect(page.getByRole("heading", { name: "Sélectionner les projets" })).toHaveCount(0);

  await page.keyboard.press("Escape");

  // No connection was created.
  await expect(page.getByText("@alice")).toHaveCount(0);
  await expect(page.getByText("@group_42_bot_e2e")).toHaveCount(0);
  await expect(page.getByText("Aucun repo pour l'instant")).toBeVisible();
});
