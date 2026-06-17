# 🛣️ Epic Espresso Bar — Roadmap

A living plan for the espresso bar app. Priorities will shift and the open
questions get resolved as each item is picked up — treat this as a working
draft, not a contract.

## Principles

- **Simple & reliable first.** Ship the smallest useful version, then iterate.
- **Zero local tooling.** Everything deploys through Vercel; no one should need
  to install anything to run it.
- **One backend, one abstraction.** New live data goes through a serverless
  function + Neon and is consumed via `assets/js/store.js` (polling). The
  front-end stays a static PWA.
- **Fun, but office-appropriate.** Keep the IT-service-desk humour light.

## Legend

✅ Shipped · 🔜 Next · 🧊 Later · 💡 Icebox · Effort: **S** (hours) /
**M** (~a day) / **L** (multi-day)

---

## ✅ Shipped (v1)

- Status board (`/display`), admin control panel (`/admin`), landing page (`/`)
- 7 themed statuses with "Epic Brew" card art + emoji fallback
- Vercel serverless API + **Neon Postgres** shared state, with localStorage demo fallback
- **PIN-gated admin**, separate public/admin deploys via `APP_ROLE` + edge middleware
- Installable **PWA** (iOS/Android) with an in-page "Install app" button
- Live connection indicator, last-updated time, custom message banner
- Espresso-cup app icon + Epic navy/gold theme
- Network-first service worker (auto-updates so fixes ship without a stale cache)
- Manager status — "Joe is in a meeting" (manual toggle + optional note)
- Order tracker — name-only queue (Queued → Making → Ready) on the board, with a "your order is ready" flash + chime
- Auto-reset — stale status reverts to Closed after ~30 min idle (configurable)
- Scan-to-open QR code in the board corner
- Google sign-in (OAuth) + visitor accounts (admin stays on the PIN)
- Self-serve ordering — signed-in visitors order from the menu; per-person cap
- Inventory — admin-managed menu (orderable items) + back-office stock counts
- Tipping — Venmo / Stripe link / crypto handoff buttons + QR on the order page (env-configured)

---

## 🔜 Next up

### ✅ 1. Manager status — "Joe is in a meeting" — shipped

**Goal:** at a glance, know whether Joe (manager) is free, in a meeting, or out —
so people know when to catch him (or not).

**MVP scope**
- New admin control (separate from coffee status): `Available` · `In a meeting`
  · `Heads-down` · `Out`, with an optional "back around HH:MM" note.
- Small badge on the board (corner) + on the landing chip, e.g.
  "👤 Joe — In a meeting (back ~2:30)".
- Hidden/neutral when set to Available, so it's not noisy.

**Data (Neon)** — designed so we can add more people later without a rewrite:
```sql
CREATE TABLE presence (
  person     text PRIMARY KEY,   -- 'joe'
  label      text NOT NULL,      -- 'Joe'
  state      text NOT NULL,      -- available | meeting | heads_down | out
  note       text DEFAULT '',    -- 'back ~2:30'
  updated_at bigint
);
```

**Approach:** `/api/presence` (GET public, POST PIN-gated) mirroring `/api/status`;
admin gains a "Manager" section; board polls and renders the badge.

**Decided & shipped:** Joe only (the bar is in his office); manual toggle with an
optional "back at" note; shown as a badge on the board and landing. Auto/calendar
sourcing remains a Later item.

### ✅ 2. Order tracker — shipped

**Goal:** a simple live queue so the barista knows what to make and people can
see where their order is.

**Shipped scope**
- Admin "Orders" panel (PIN-gated): add a name, advance it
  Queued → Making → Ready, "Serve" to clear it, or remove it.
- Board shows the queue on the **main board** — chips grouped Ready → Making →
  Queued; a newly-Ready order triggers a full-screen flash + a chime
  (with a 🔔 mute toggle that also unlocks audio on kiosks).
- Name only — no drink field.

**Data (Neon):** a `coffee_orders` table (`id, name, state, created_at,
updated_at`), created on demand like the rest of the schema.

**Approach:** folded into `/api/status` (the same single poll as coffee + Joe)
with `{ order: { action } }` writes, kept behind the `store.js` abstraction.

**Decided & shipped:** name-only; Queued → Making → Ready (advancing past Ready
"serves"/removes it); shown on the **main board** with a ready flash + chime.
A dedicated `/orders` screen for a second monitor remains a possible later add.

### ✅ 3. Auto-reset after inactivity — shipped

Reverts to `Closed` if the coffee status sits untouched for ~30 min, so the board
never lies after everyone goes home. Implemented **read-time** in `/api/status`
(no cron needed on the free tier) — leaves Joe and the order queue untouched.
Tunable via `AUTO_RESET_MINUTES` (default `30`; `0` disables it).

### ✅ 4. QR code on the board — shipped

A small QR in the board's corner linking to the site's own origin, so anyone can
scan to open/install the app on their phone. Generated **client-side** from a
vendored zero-dependency lib (`assets/js/vendor/qrcode.js`) using
`location.origin`, so it always matches the serving domain and works offline.

---

## 🧊 Later

- **AI-generated daily card art** — regenerate Epic-chan's pose/scene each day
  with an image model (e.g. OpenAI `gpt-image-1`). Feasible, with caveats:
  generate *text-free* scene art and keep the status word/tagline as the current
  HTML overlay (models render baked-in text unreliably); hold Epic-chan
  consistent with a fixed character prompt + a reference image; run on a daily
  **Vercel Cron**, store output in **Vercel Blob**, and fall back to the current
  cards on any failure. Needs `OPENAI_API_KEY`; ~7 images/day at a few cents
  each. **L**
- **Calendar-driven manager status** — auto-set Joe's "in a meeting" from
  Microsoft 365 / Outlook (Graph API) or Teams presence, server-side poll. **L**
- **Notifications** — post to Teams/Discord on key changes ("☕ Coffee is READY",
  "Beans low") via an incoming webhook from the API. **M**
- **Animated Epic-chan mascot** — short WebM/MP4 loop per status instead of the
  static card. **M**
- **Status history & stats** — log changes to Neon; show uptime, busiest times,
  most-common status, "coffee served" tally. **M**
- **Multiple PINs / per-user login / SSO** — replace the shared PIN with named
  staff accounts (or Microsoft SSO) for accountability. **L**

---

## 💡 Icebox

- **Physical ESP32 button** at the bar that POSTs to `/api/status`. **M**
- **Multiple bars / locations** with a picker. **L**
- **Gamification** — leaderboard of who refills the beans, streaks, etc. **S–M**

---

## How we ship

1. Build the smallest useful version on a branch.
2. Push → check the Vercel **Preview** deploy → merge to `main` for production.
3. Keep new live data behind a serverless function + the `store.js` abstraction.
4. Update this file when scope or priorities change.

> Want these as GitHub Issues / a Project board instead of (or alongside) this
> file? That's easy to generate from this list — just say the word.
