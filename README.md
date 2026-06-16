# ☕ Epic Espresso Bar — Coffee Status Board

The official web app / status tracker for the **Epic Espresso Bar** ("The
Brendan Spurlock Memorial Espresso Bar").

A lightweight, installable status sign. Staff set the current coffee status from
a phone (the **Admin** app); a warehouse tablet or monitor shows it on the
**Status board**. It runs entirely on **Vercel** — a static front-end plus one
tiny serverless function backed by **Neon Postgres** — and installs on iOS and
Android as a **PWA** (Add to Home Screen). No Firebase, no app stores, and
**nothing to install or run on your own computer.**

| Page         | URL        | Who                                                  |
| ------------ | ---------- | ---------------------------------------------------- |
| Status board | `/display` | Everyone — public, read-only, kiosk/phone            |
| Admin        | `/admin`   | Staff only — **PIN-protected**, on a separate deploy |
| Landing      | `/`        | Links + a live status chip                           |

Statuses: **Brewing · Ready · Empty · Cleaning · Closed · Beans Low · Maintenance**,
each with its own icon, default message, and full-screen theme.

---

## Contents

- [How it works](#how-it-works)
- [Deploy on Vercel (no local tools)](#deploy-on-vercel-no-local-tools)
  - [1. Status board (public)](#1-status-board-public-project)
  - [2. Neon Postgres + admin PIN](#2-add-neon-postgres--the-admin-pin)
  - [3. Admin (separate URL)](#3-admin-on-a-separate-url-second-project)
- [Environment variables](#environment-variables)
- [Install as an app (iOS / Android)](#install-as-an-app-ios--android)
- [Using it](#using-it)
- [Kiosk mode on a tablet](#kiosk-mode-on-a-tablet)
- [Project structure](#project-structure)
- [Customising](#customising)
- [Demo mode & optional local dev](#demo-mode--optional-local-dev)
- [Future enhancements](#future-enhancements)

---

## How it works

One tiny shared state object drives everything:

```jsonc
{ "status": "ready", "message": "Coffee is ready.", "updatedAt": 1718553600000 }
```

- **Storage:** a single serverless function, `/api/status`, reads/writes that
  object in **Neon** (serverless Postgres). `GET` is public; `POST` requires the admin
  **PIN** and is rejected entirely on the public deployment.
- **Live updates:** the board and admin **poll** `/api/status` every few seconds
  (Vercel has no built-in realtime push; polling is simple and reliable for a
  status sign). The service worker never caches the API, so reads stay live.
- **Separation:** the front-end is one codebase deployed as **two Vercel
  projects** that share the same Neon database. An `APP_ROLE` env var + a 6-line
  Edge Middleware make the public project read-only and hide `/admin`, while the
  admin project serves the PIN-gated panel. Two URLs, one repo, no duplication.
- **Fallback:** if the API isn't reachable (e.g. the database isn't set up yet), the app
  drops to a clearly-labelled **demo mode** (localStorage, single device).

All of this is wired through one abstraction — `assets/js/store.js` — so the UI
never talks to the backend directly.

---

## Deploy on Vercel (no local tools)

Everything below is done in the **Vercel dashboard** and the **GitHub**
website. You don't need Node, the Vercel CLI, or anything on your machine.

### 1. Status board (public project)

1. Push this repo to GitHub (already done if you're reading this there).
2. [vercel.com](https://vercel.com) → **Add New → Project → Import Git
   Repository** → pick this repo (grant the Vercel GitHub app access).
3. **Framework Preset: Other**, **Root Directory: `./`**. Leave Build & Output
   empty. **Deploy.** You now have `https://<project>.vercel.app`.

### 2. Add Neon Postgres + the admin PIN

1. In the project → **Storage → Create Database → Neon (Postgres)** from the
   Marketplace. Accept the **Free** plan and **Connect** it to this project.
   This injects `DATABASE_URL` automatically (the table is created on first
   use — no migration step).
2. Project → **Settings → Environment Variables**, add:
   - `ADMIN_PIN` = your chosen passcode (e.g. `4827`)
   - `APP_ROLE` = `public`  ← makes this deployment read-only and hides `/admin`
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the new settings take effect.

The status board is now live. `/admin` here redirects to the board.

### 3. Admin on a separate URL (second project)

1. **Add New → Project → Import** the **same repo** again. Name it e.g.
   `epic-espresso-admin`. Framework **Other**, Root `./`. **Deploy.**
2. **Storage:** connect the **same Neon database** you created in step 2 to this
   project (Storage → Connect Database → pick the existing one). Sharing the
   database is what keeps both URLs in sync.
3. **Settings → Environment Variables:**
   - `ADMIN_PIN` = the **same** passcode as the public project
   - `APP_ROLE` = `admin`
4. **Redeploy.** Your staff admin URL is `https://epic-espresso-admin.vercel.app`
   → opens the PIN-gated control panel.

> Want a single URL instead of two? Deploy just one project, set `ADMIN_PIN`,
> and leave `APP_ROLE` unset. Then `/admin` is reachable on the same domain but
> still locked behind the PIN.

Both projects auto-deploy on every push to `main`.

---

## Environment variables

| Variable                          | Where                | Purpose                                                  |
| --------------------------------- | -------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                    | both projects        | Neon connection string (added automatically by Storage)  |
| `ADMIN_PIN`                       | admin project (req.) | Passcode required to write. Set on public too if single-project |
| `APP_ROLE`                        | both                 | `public` = read-only + admin hidden; `admin`/unset = full |

`POSTGRES_URL` / `DATABASE_URL_UNPOOLED` are also accepted. No secrets ever live
in the repo.

---

## Install as an app (iOS / Android)

It's a PWA, so it installs straight from the browser — no App Store / Play Store.

- **iPhone / iPad (Safari):** open the URL → **Share** → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu **⋮** → **Install app** (or *Add to
  Home screen*).

Installed apps get the Epic espresso icon, launch full-screen, and remember
which one they are: the public URL installs as **Espresso** (opens the board),
the admin URL installs as **Espresso Admin** (opens the PIN screen).

---

## Using it

**Status board (`/display`)** — title, a big icon, the status in huge text, the
message, and last-updated time, themed per status. Updates live; no refresh.
Tap **⛶** for full-screen (it also keeps the screen awake where supported).

**Admin (`/admin`)**

- Enter the **PIN** once per session to unlock.
- Tap a status button to go live instantly.
- The **Optional message** overrides the status's default note (leave blank to
  use the default — the placeholder shows what that'll be).
- **Update message only** changes the note without changing the status.
- The **Currently live** card mirrors the board; failed saves show a clear error.

Both pages show a **connection indicator**: green = live, amber = demo mode,
red = reconnecting.

---

## Kiosk mode on a tablet

1. Open `…/display` on the tablet/monitor and tap **⛶**.
2. For always-on: **iPad** → Add to Home Screen, launch from the icon;
   **Android** → Install app, or use a kiosk-browser app; **dedicated displays**
   → Chrome `--kiosk <url>` or a digital-signage app.
3. Disable the device's auto-lock / sleep for a permanent sign.

---

## Project structure

```
.
├── index.html              # Landing (/)
├── admin/
│   ├── index.html          # Admin panel (/admin)
│   └── manifest.webmanifest# PWA manifest for the admin app
├── display/index.html      # Status board (/display)
├── api/status.js           # Serverless: GET/POST shared state in Neon Postgres
├── middleware.js           # Edge: hides /admin on the public (APP_ROLE) deploy
├── manifest.webmanifest    # PWA manifest for the public app
├── sw.js                   # Service worker (installable + offline shell)
├── assets/
│   ├── css/                # base (tokens + themes), landing, admin, display
│   ├── js/
│   │   ├── config.js       # API path + poll interval (no secrets)
│   │   ├── statuses.js     # Status catalogue (labels, icons, taglines)
│   │   ├── store.js        # Storage abstraction (live API | demo)
│   │   ├── util.js, pwa.js, landing.js, admin.js, display.js
│   └── img/                # icons + img/status/ (Epic Brew card art, WebP)
├── package.json            # Neon driver dependency (Vercel installs it)
└── vercel.json
```

---

## Customising

- **Statuses:** edit `assets/js/statuses.js` (one entry per status) and add a
  matching `body[data-status="…"]` theme block in `assets/css/base.css`. Keep
  the id list in sync with the `STATUSES` array in `api/status.js`.
- **Brand colours:** the `--epic-*` and chrome variables live at the top of
  `assets/css/base.css`.
- **App icon:** replace `assets/img/epic-icon.svg` and regenerate the PNGs
  (`icon-192/512`, `icon-maskable-512`, `apple-touch-icon`, `favicon-32`) with
  any SVG→PNG tool. The current icon is an espresso cup in Epic colours —
  intentionally distinct from the Epic Charter Schools logo.
- **Status card art:** the board images live in `assets/img/status/<id>.webp`
  (~1280px, ~85 KB each). Replace one with the same name to reskin a status.
  They're shown full-size on the board and as a thumbnail in admin; if a card is
  missing, the app falls back to the emoji + status word.

---

## Demo mode & optional local dev

With no database configured, the app runs in **demo mode**: state is stored in the
browser's localStorage (single device, syncs across tabs). It's the zero-config
fallback — fine for a quick look, not for driving a separate board.

Local development is **optional** (you don't need it to deploy). If you want it,
`npx vercel dev` runs the functions + database locally; a plain static server
(`npx serve .`) serves the pages in demo mode only (no `/api`).

---

## Future enhancements

- 🐣 **Epic-chan animated mascot** on the board.
- 🎬 **Per-status WebM/MP4 animations** (swap the emoji for short loops).
- 🔳 **QR code** on the board linking to itself / a mobile status view.
- 🔔 **Teams / Discord notification** on status change (webhook from the API).
- ⏲️ **Scheduled auto-reset** (revert to *Closed* / *Empty* after 30 min).
- 🔘 **Physical ESP32 button** that POSTs to `/api/status` to flip status.
- 🔐 **Per-user logins / SSO** instead of a shared PIN.

---

## License

[MIT](LICENSE) © 2026 deadoscillate
