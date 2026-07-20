# ☕ Epic Espresso Bar — Coffee Status Board

The official web app / status tracker for the **Epic Espresso Bar** ("The
Brendan Spurlock Memorial Espresso Bar").

A lightweight, installable status sign. Staff set the current coffee status from
a phone (the **Admin** app); a warehouse tablet or monitor shows it on the
**Status board**. It runs entirely on **Vercel** — a static front-end plus a few
small serverless functions backed by **Neon Postgres** — and installs on iOS and
Android as a **PWA** (Add to Home Screen). No Firebase, no app stores, and
**nothing to install or run on your own computer.**

| Page         | URL        | Who                                       |
| ------------ | ---------- | ----------------------------------------- |
| Status board | `/display` | Everyone — public, read-only, kiosk/phone |
| Order        | `/order`   | Everyone — enter a name and place an order |
| Admin        | `/admin`   | Staff only — **PIN-protected**            |
| Landing      | `/`        | Links + a live status chip                |

Statuses: **Brewing · Ready · Empty · Cleaning · Closed · Beans Low · Maintenance**,
each with its own icon, default message, and full-screen theme.

---

## Contents

- [How it works](#how-it-works)
- [Deploy on Vercel (no local tools)](#deploy-on-vercel-no-local-tools)
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
  object in **Neon** (serverless Postgres). Reads and new visitor orders are
  public; status, manager, queue-management, and inventory writes require the
  admin **PIN**.
- **Live updates:** the board and admin **poll** `/api/status` every few seconds
  (Vercel has no built-in realtime push; polling is simple and reliable for a
  status sign). The service worker never caches the API, so reads stay live.
- **One site:** landing, ordering, status board, and admin all run on one Vercel
  project. `/admin` is reachable from the same domain, but its controls stay
  locked until the server verifies the configured PIN.
- **Fallback:** if the API isn't reachable (e.g. the database isn't set up yet), the app
  drops to a clearly-labelled **demo mode** (localStorage, single device).

All of this is wired through one abstraction — `assets/js/store.js` — so the UI
never talks to the backend directly.

---

## Deploy on Vercel (no local tools)

Everything below is done in the **Vercel dashboard** and the **GitHub**
website. You don't need Node, the Vercel CLI, or anything on your machine.

1. Push this repo to GitHub (already done if you're reading this there).
2. [vercel.com](https://vercel.com) → **Add New → Project → Import Git
   Repository** → pick this repo (grant the Vercel GitHub app access).
3. **Framework Preset: Other**, **Root Directory: `./`**. Leave Build & Output
   empty. **Deploy.** You now have `https://<project>.vercel.app`.
4. In the project → **Storage → Create Database → Neon (Postgres)** from the
   Marketplace. Accept the **Free** plan and **Connect** it to this project.
   This injects `DATABASE_URL` automatically (the table is created on first
   use — no migration step).
5. Project → **Settings → Environment Variables**, add:
   - `ADMIN_PIN` = your chosen passcode (e.g. `4827`)
6. **Redeploy** (Deployments → ⋯ → Redeploy) so the new settings take effect.

The landing page, `/display`, `/order`, and PIN-gated `/admin` now share one URL.
The project auto-deploys on every push to `main`.

If you are migrating from the older two-project setup, keep the project/domain
you want visitors to use, connect it to the existing Neon database, set
`ADMIN_PIN`, and redeploy. The old `APP_ROLE`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` variables are no longer used and
can be removed. Verify `/display`, `/order`, and `/admin` on that domain before
retiring the second Vercel project.

---

## Environment variables

| Variable                          | Required | Purpose                                                  |
| --------------------------------- | -------- | -------------------------------------------------------- |
| `DATABASE_URL`                    | yes      | Neon connection string (added automatically by Storage)  |
| `ADMIN_PIN`                       | yes      | Passcode required for all admin writes                   |
| `AUTO_RESET_MINUTES`              | no       | Revert the status to Closed after this many idle minutes (default `30`; `0` = off). Ignored when scheduling is on |
| `SCHEDULE_ENABLED`                | no       | Initial auto-schedule default — **on by default** (`false` disables) |
| `SCHEDULE_OPEN` / `SCHEDULE_CLOSE`| no       | Initial local hours (defaults `08:00` / `16:30`) |
| `SCHEDULE_TZ`                     | no       | Initial IANA timezone (default `America/Chicago`; DST-aware) |
| `SCHEDULE_DAYS`                   | no       | Initial business days, e.g. `1-5` = Mon–Fri (default) |
| `SCHEDULE_OPEN_STATUS`            | no       | Initial status set at opening (default `ready`) |
| `TIP_VENMO`                       | no       | Venmo username — shows a "Tip on Venmo" button/QR on /order |
| `TIP_STRIPE_URL`                  | no       | A Stripe Payment Link URL — shows a "Tip with card" button/QR |
| `TIP_CRYPTO_ADDRESS`              | no       | Wallet address — shows a tip QR + copyable address (`TIP_CRYPTO_LABEL`, `TIP_CRYPTO_URI` optional) |

`POSTGRES_URL` / `DATABASE_URL_UNPOOLED` are also accepted. No secrets ever live
in the repo. Visitor ordering requires no account: the visitor enters a display
name, chooses an item, and the order appears in the shared queue.

The `SCHEDULE_*` variables seed the defaults for a new database. Once hours are
saved from the PIN-protected Admin page, the saved database values take priority.

---

## Install as an app (iOS / Android)

It's a PWA, so it installs straight from the browser — no App Store / Play Store.

- **iPhone / iPad (Safari):** open the URL → **Share** → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu **⋮** → **Install app** (or *Add to
  Home screen*).

Installed apps get the Epic espresso icon and launch full-screen. The public
manifest opens the board; installing from `/admin` uses the separate **Espresso
Admin** manifest and opens the PIN screen on the same domain.

---

## Using it

**Status board (`/display`)** — title, the big "Epic Brew" status card, the
message, and last-updated time, themed per status. Shows a **Joe** badge when the
manager isn't free, plus the **order queue** — a newly-Ready order triggers a
full-screen flash and a chime (**🔔** toggles the sound). A **QR code** in the
corner lets people scan to open/install the app on their phone. The board runs on
a **schedule** (default 08:00–16:30 Central, Mon–Fri): it forces **Closed** outside
those hours and opens itself in the morning, so it never lies overnight. Staff can
set the days, times, timezone, opening status, or disable automatic hours from
the Admin page. When disabled, `AUTO_RESET_MINUTES` handles stale status instead.
Updates live; no refresh. Tap **⛶** for full-screen
(it also keeps the screen awake where supported).

**Admin (`/admin`)**

- Enter the **PIN** once per session to unlock.
- Tap a status button to go live instantly.
- The **Optional message** overrides the status's default note (leave blank to
  use the default — the placeholder shows what that'll be).
- **Update message only** changes the note without changing the status.
- **Hours of operation:** set the open days, opening and closing times, timezone,
  and opening status, or turn the automatic schedule off.
- **Manager — Joe:** set Available / In a meeting / Heads-down / Out, with an
  optional "back ~2:30" note (shown as a badge on the board).
- **Orders:** add a name to the queue, then advance it Queued → Making → Ready
  (Ready flashes + chimes on the board); **Serve** clears it.
- **Inventory:** add items with a stock count and an **On menu** toggle. Items
  on the menu are what visitors can order; stock is just for your tracking.
- The **Currently live** card mirrors the board; failed saves show a clear error.

**Order (`/order`)** — visitors enter a name, pick an item from the menu, and
watch the live queue with their own orders highlighted (their phone buzzes when
it's ready). No account is required. Admin still serves/advances from `/admin`.
If any `TIP_*` var is set, a **Tip the barista**
section appears with buttons + QR codes (Venmo / Stripe link / crypto) — these
are handoff links only; no money flows through the app.

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
├── order/index.html        # Account-free self-serve ordering (/order)
├── api/
│   ├── status.js           # GET/POST shared state (status, manager, orders) in Neon
│   ├── inventory.js        # GET/POST the menu + stock (admin PIN to write)
│   └── tip-config.js       # Public, environment-driven tip destinations
├── manifest.webmanifest    # PWA manifest for the public app
├── sw.js                   # Service worker (installable + offline shell)
├── assets/
│   ├── css/                # base (tokens + themes), landing, admin, display, order
│   ├── js/
│   │   ├── config.js       # API path + poll interval (no secrets)
│   │   ├── statuses.js     # Status + order-state + manager catalogues
│   │   ├── store.js        # Storage abstraction (live API | demo)
│   │   ├── util.js, pwa.js, install.js, landing.js, admin.js, display.js, order.js
│   │   └── vendor/qrcode.js# Vendored QR generator (MIT) for the board QR
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

## Roadmap

Shipped recently: the **Joe "in a meeting" status** and the **order tracker**.
Still planned — auto-reset, a QR install code, AI-generated daily card art,
Teams/Discord notifications, an animated mascot, and more — live in
**[ROADMAP.md](ROADMAP.md)**.

---

## License

[MIT](LICENSE) © 2026 deadoscillate
