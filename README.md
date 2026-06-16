# ☕ The Brendan Spurlock Memorial Espresso Bar

The official web app / status tracker for the **Epic IT Service Desk Espresso Bar**.

A lightweight, browser-based coffee-status sign. Baristas set the current status
from a phone or laptop (`/admin`); a warehouse tablet or monitor shows it
fullscreen (`/display`). No native app, no install — just static HTML, CSS, and
JavaScript.

| Page       | What it is                                                        |
| ---------- | ----------------------------------------------------------------- |
| `/`        | Landing page with links to Admin and Display + a live status chip |
| `/admin`   | Control panel: big status buttons + optional custom message       |
| `/display` | Fullscreen, read-from-a-distance status board for the warehouse   |

Statuses: **Brewing · Ready · Empty · Cleaning · Closed · Beans Low · Maintenance**,
each with its own icon, default message, and visual theme.

---

## Table of contents

- [How it works](#how-it-works)
- [Run it locally](#run-it-locally)
- [Demo mode vs. live sync](#demo-mode-vs-live-sync)
- [Configure Firebase (cross-device sync)](#configure-firebase-cross-device-sync)
- [Deploy](#deploy)
  - [GitHub Pages](#github-pages)
  - [Netlify](#netlify)
  - [Vercel](#vercel)
- [Using Admin & Display](#using-admin--display)
- [Kiosk / fullscreen on a tablet](#kiosk--fullscreen-on-a-tablet)
- [Project structure](#project-structure)
- [Swapping the backend (Supabase, etc.)](#swapping-the-backend-supabase-etc)
- [Future enhancements](#future-enhancements)

---

## How it works

A single tiny shared state object drives everything:

```jsonc
{
  "status": "ready",
  "message": "Coffee is ready.",
  "updatedAt": 1718553600000
}
```

The admin writes it; the display subscribes and updates live. All storage goes
through one **abstraction layer** (`assets/js/store.js`) so the UI never talks to
a database directly. The store automatically picks a backend:

- **Firebase Realtime Database** — when you've filled in your config. True
  cross-device, live sync. _(Recommended for real use.)_
- **Demo mode (localStorage)** — the zero-config fallback. Works instantly, but
  only on a **single device** (it does sync between tabs/windows on that one
  machine). Clearly labelled in the connection indicator.

Both pages show a **connection indicator** so you always know which mode you're
in and whether you're live.

---

## Run it locally

Because the app uses native ES modules, open it through a small web server
(not `file://`). Any static server works:

```bash
# Option A — Node (no install needed)
npx serve .

# Option B — Python 3
python3 -m http.server 8080
```

Then visit:

- `http://localhost:8080/` (landing)
- `http://localhost:8080/admin/`
- `http://localhost:8080/display/`

Out of the box it runs in **demo mode** — open `/admin/` and `/display/` in two
tabs of the same browser and watch them sync.

---

## Demo mode vs. live sync

| | Demo mode (default) | Firebase (configured) |
| --- | --- | --- |
| Setup | None | ~5 minutes |
| Syncs across devices | ❌ single device only | ✅ yes |
| Syncs across tabs (same device) | ✅ | ✅ |
| Good for | Trying it out, local demos | Real espresso-bar use |

> **Important:** the admin (phone) and the warehouse display are different
> devices, so for real use you need Firebase. Demo mode is purely a
> zero-config fallback for evaluation.

---

## Configure Firebase (cross-device sync)

Firebase **web** config values are *not* secret — they're meant to ship in
client code, and access is controlled by database security rules. They live in
`assets/js/config.js` so you can swap projects without touching app logic.

**1. Create a project**
Go to the [Firebase console](https://console.firebase.google.com) → **Add
project** (Google Analytics optional).

**2. Create a Realtime Database**
Left menu → **Build → Realtime Database → Create Database**. Pick a location and
start in **test mode** (you'll tighten this in step 5).

**3. Register a Web app**
Project settings (⚙️) → **General → Your apps → Web (`</>`)**. Give it a
nickname. Firebase shows you a `firebaseConfig = { … }` object — copy it.

**4. Paste your values into `assets/js/config.js`**

```js
export const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123",
};
```

The app switches to Firebase automatically once `apiKey` and `databaseURL` are
filled in. (Prefer to keep this file out of git? Add it to `.gitignore` and
commit a copy named `config.example.js` — the app only imports `config.js`.)

**5. Lock down your database rules**
In **Realtime Database → Rules**, paste the contents of
[`firebase.rules.json`](firebase.rules.json). These allow open read/write (fine
for an internal sign) **but validate the shape** and cap the message length:

```json
{
  "rules": {
    "coffee": {
      ".read": true,
      ".write": true,
      ".validate": "newData.hasChildren(['status', 'message', 'updatedAt'])",
      "status":    { ".validate": "newData.isString() && newData.val().length <= 32" },
      "message":   { ".validate": "newData.isString() && newData.val().length <= 280" },
      "updatedAt": { ".validate": "newData.isNumber()" }
    }
  }
}
```

> Anyone with the URL can still write. For a public deployment, add PIN/auth
> protection for `/admin` (see [Future enhancements](#future-enhancements)) and
> restrict `.write` accordingly.

---

## Deploy

It's a static site — host the repo root as-is. The clean `/admin` and `/display`
URLs work everywhere because each is its own `index.html` in a folder. The
included `.nojekyll` file keeps GitHub Pages from mangling the `assets/` folder.

### GitHub Pages

1. Push to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch.**
3. Choose your branch and `/ (root)`, then **Save**.
4. Your site appears at `https://<user>.github.io/<repo>/` — with
   `…/admin/` and `…/display/`.

(All paths in the app are relative, so it works fine under the `/<repo>/`
subpath.)

### Netlify

- **Drag & drop:** drop the project folder onto the Netlify dashboard.
- **Git:** “Add new site → Import from Git.” No build command needed;
  set the **publish directory** to the repo root (`.`).

### Vercel

This repo includes a `vercel.json`, so deploys are zero-config (static site,
no build step, with light caching on `/assets`).

1. [vercel.com](https://vercel.com) → **Add New → Project → Import Git
   Repository** → pick `deadoscillate/epic-espresso` (grant the Vercel GitHub
   app access to the repo when prompted).
2. **Framework Preset: Other**, **Root Directory: `./`** — leave the Build &
   Output settings empty. Click **Deploy**.
3. Vercel then auto-deploys on every push: your **Production Branch** (default
   `main`) publishes to the production URL, while other branches get **Preview**
   deployments. To ship this work to production, merge it into `main` — or set
   the Production Branch under **Project → Settings → Git**.

Prefer the CLI? `npm i -g vercel`, then run `vercel` (link/create the project)
and `vercel --prod` from the repo root.

---

## Using Admin & Display

**Admin (`/admin`)**

- Tap a big status button to go live immediately.
- The **Optional message** box overrides the status's default note. Leave it
  blank to use the default (the placeholder shows what that'll be).
- **Update message only** changes the note without changing the status.
- The **Currently live** card shows exactly what the display is showing, with
  the last-updated time. If a save fails, you'll get a clear error toast.

**Display (`/display`)**

- Shows the title, a big icon, the status in huge text, the message, and
  last-updated time — all themed per status.
- Updates live; no refresh needed.
- Tap the **⛶** button (top-right) to go fullscreen.

---

## Kiosk / fullscreen on a tablet

1. On the warehouse tablet/monitor, open `…/display/`.
2. Tap the **⛶** fullscreen button. The page also tries to keep the screen
   awake (Screen Wake Lock) while fullscreen, where supported.
3. For an always-on kiosk:
   - **iPad/Safari:** Share → *Add to Home Screen*, launch from the icon for a
     chrome-free view.
   - **Android/Chrome:** ⋮ → *Add to Home screen*, or use a kiosk-browser app.
   - **Dedicated displays:** Chrome's `--kiosk <url>` launch flag, or a digital
     signage app pointed at the display URL.
4. In device display settings, disable auto-lock / sleep for a permanent sign.

---

## Project structure

```
.
├── index.html              # Landing (/)
├── admin/index.html        # Admin control panel (/admin)
├── display/index.html      # Fullscreen display (/display)
├── assets/
│   ├── css/
│   │   ├── base.css         # Tokens, reset, connection pill, per-status themes
│   │   ├── landing.css
│   │   ├── admin.css
│   │   └── display.css
│   └── js/
│       ├── config.js        # ← your Firebase config goes here
│       ├── statuses.js      # Status catalogue (labels, icons, taglines, themes)
│       ├── store.js         # Storage abstraction (Firebase | demo mode)
│       ├── util.js          # Time formatting + connection renderer
│       ├── landing.js
│       ├── admin.js
│       └── display.js
├── firebase.rules.json     # Ready-to-paste Realtime Database rules
└── .nojekyll               # Keeps GitHub Pages from touching /assets
```

**Want to add or rename a status?** Edit `assets/js/statuses.js` (one entry per
status) and add a matching `body[data-status="…"]` theme block in
`assets/css/base.css`. Both pages update automatically.

---

## Swapping the backend (Supabase, etc.)

Everything funnels through `createCoffeeStore()` in `assets/js/store.js`, which
exposes a tiny interface:

```js
store.onChange(state => { /* { status, message, updatedAt } */ });
store.onConnection(conn => { /* { online, mode, label } */ });
await store.setStatus({ status, message });
await store.init();
```

To use Supabase (or any backend), add an `initSupabase()` alongside
`initFirebase()` that wires up the same `setState` / `setConnection` callbacks
and assigns `applyWrite`. Supabase Realtime maps cleanly: subscribe to a
single-row table for `onChange`, `upsert` in `applyWrite`. No UI changes needed.

---

## Future enhancements

Planned/parked ideas (intentionally out of scope for v1):

- 🐣 **Epic-chan animated mascot** on the display.
- 🎬 **Per-status WebM/MP4 animations** (swap the emoji for short loops).
- 🔳 **QR code** on the display linking to itself / a mobile status view.
- 🔒 **PIN / password protection** for `/admin` (plus tightened DB write rules).
- ⏲️ **Scheduled auto-reset** (e.g. revert to *Closed* / *Empty* after 30 min).
- 🔔 **Teams / Discord notifications** on status change (via webhook).
- 🔘 **Physical ESP32 button** that hits the backend to flip status from the bar.

---

## License

[MIT](LICENSE) © 2026 deadoscillate
