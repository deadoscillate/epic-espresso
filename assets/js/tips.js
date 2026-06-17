// -----------------------------------------------------------------------------
// Tipping — handoff buttons + QR (Venmo / Stripe Payment Link / crypto address).
// No money flows through the app; we just surface the bar's public pay targets.
// Needs the vendored QR lib (window.qrcode) loaded as a classic script.
// -----------------------------------------------------------------------------

function qrSvg(text) {
  if (typeof window.qrcode !== "function") return "";
  try {
    const q = window.qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    return "";
  }
}

function tile({ title, qrData, actionHref, actionLabel, address }) {
  const el = document.createElement("div");
  el.className = "tip-tile";

  const h = document.createElement("div");
  h.className = "tip-tile__title";
  h.textContent = title;
  el.appendChild(h);

  const svg = qrSvg(qrData);
  if (svg) {
    const qr = document.createElement("div");
    qr.className = "tip-tile__qr";
    qr.innerHTML = svg;
    el.appendChild(qr);
  }

  if (actionHref) {
    const a = document.createElement("a");
    a.className = "btn btn-primary tip-tile__btn";
    a.href = actionHref;
    a.textContent = actionLabel;
    a.target = "_blank";
    a.rel = "noopener";
    el.appendChild(a);
  }

  if (address) {
    const addr = document.createElement("div");
    addr.className = "tip-tile__addr";
    addr.textContent = address;
    el.appendChild(addr);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn tip-tile__copy";
    copy.textContent = "Copy address";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(address);
        copy.textContent = "Copied!";
      } catch {
        copy.textContent = "Copy failed";
      }
      setTimeout(() => (copy.textContent = "Copy address"), 1500);
    });
    el.appendChild(copy);
  }

  return el;
}

export async function setupTips(section, grid) {
  if (!section || !grid) return;
  let cfg = {};
  try {
    const res = await fetch("/api/tip-config", { cache: "no-store" });
    if (res.ok) cfg = await res.json();
  } catch {
    return; // leave the section hidden
  }

  const tiles = [];
  if (cfg.venmo) {
    const url = `https://venmo.com/${encodeURIComponent(cfg.venmo)}?txn=pay&note=${encodeURIComponent(cfg.venmoNote || "Coffee tip")}`;
    tiles.push(tile({ title: "Venmo", qrData: url, actionHref: url, actionLabel: "Tip on Venmo" }));
  }
  if (cfg.stripeUrl) {
    tiles.push(tile({ title: "Card", qrData: cfg.stripeUrl, actionHref: cfg.stripeUrl, actionLabel: "Tip with card" }));
  }
  if (cfg.crypto && cfg.crypto.address) {
    tiles.push(
      tile({
        title: cfg.crypto.label || "Crypto",
        qrData: cfg.crypto.uri || cfg.crypto.address,
        actionHref: cfg.crypto.uri || "",
        actionLabel: "Open wallet",
        address: cfg.crypto.address,
      })
    );
  }

  if (!tiles.length) {
    section.hidden = true;
    return;
  }
  grid.textContent = "";
  tiles.forEach((t) => grid.appendChild(t));
  section.hidden = false;
}
