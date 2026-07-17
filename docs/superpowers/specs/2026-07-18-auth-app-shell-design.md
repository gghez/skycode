# skycode — Authentication & Application Shell (Slice 1)

**Date:** 2026-07-18
**Status:** Approved design, pending implementation plan

## Objective and Scope

Establish the web foundation of skycode: a person can **create an account**, **sign
in**, **sign out**, and land in a **navigable application shell** — with no repo/review
business logic yet (that comes in later specs).

**In scope**
- Email + password registration (open, account active immediately on signup)
- Sign in / sign out
- Session-protected application area with a sidebar shell
- Empty "Repos" page and an account menu (shows the signed-in email, sign out)

**Out of scope (deferred to later specs)**
- Email verification and password reset (require mail infrastructure)
- OIDC / third-party identity providers
- Invitations
- Real repository and review management

## Technical Stack

- **Next.js (App Router) + TypeScript** — frontend and API in a single project.
- **better-auth** — email/password provider, httpOnly cookie sessions, password hashing
  handled by the library.
- **PostgreSQL + Drizzle ORM**, run locally via **Docker Compose**. Versioned migrations
  with `drizzle-kit`.
- **Tailwind CSS + shadcn/ui** — components owned inside the repository.

## Architecture (isolated units)

- **`db/`** — Drizzle schema (the `user`, `session`, `account`, `verification` tables
  required by better-auth), connection client, migrations. Single responsibility: data
  access.
- **`auth/`** — better-auth configuration (Drizzle adapter, email/password provider) and
  the route handler mounted at `app/api/auth/[...all]/route.ts`. Exposes a typed auth
  client for the frontend.
- **`app/(public)/`** — unauthenticated pages: `login`, `register` (centered-card layout,
  toggle between sign in and sign up).
- **`app/(app)/`** — protected area, wrapped by the **sidebar shell** (Repos / Revues /
  Activité + account menu). A server-side guard redirects to `/login` when there is no
  session. The `repos` page renders an empty state.
- **`components/ui/`** — shadcn primitives (button, input, card, dropdown-menu…).
- **`components/shell/`** — `Sidebar`, `AccountMenu` (dropdown/hamburger: shows email +
  sign out).

## UI Decisions

- **Application shell:** persistent left **sidebar** (Repos / Revues / Activité) plus an
  account menu; primary actions always visible, secondary items in the account
  dropdown/hamburger.
- **Auth screens:** **centered card**, full-screen neutral background, with a toggle
  between sign in and sign up.
- **Registration fields:** email + password only (no display name).

## Data Flow

- **Sign up:** form → `authClient.signUp.email({email, password})` → better-auth creates
  `user` + `session`, sets the cookie → redirect to `/repos`.
- **Sign in:** form → `authClient.signIn.email(...)` → session cookie → redirect to
  `/repos`.
- **Protected area:** on each request the guard reads the session server-side; if absent →
  `redirect('/login')`.
- **Sign out:** `authClient.signOut()` → cookie invalidated → back to `/login`.

## Error Handling

- Forms: client-side validation (valid email, password ≥ 8 characters) **and** server-side
  validation via better-auth. Inline messages under fields ("email already in use",
  "invalid credentials").
- Loading states on buttons (disabled + spinner) during requests.

## Testing

- **Unit/integration (Vitest):** the route guard redirects without a session; the Drizzle
  schema applies its migrations against a test database.
- **E2E (Playwright):** full journey sign up → land on `/repos` → sign out → sign in. This
  is the test that proves the slice works end-to-end.

## Repository Structure (standard Next.js)

```
docker-compose.yml        # local postgres
drizzle.config.ts
src/
  db/            # schema, client, migrations
  auth/          # better-auth config + client
  app/
    (public)/login, register
    (app)/repos        # + layout with sidebar
    api/auth/[...all]/route.ts
  components/ui, components/shell
```
