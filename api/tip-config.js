// -----------------------------------------------------------------------------
// /api/tip-config — public, env-driven tip targets (no money flows through here)
// -----------------------------------------------------------------------------
//   GET -> { venmo?, venmoNote?, stripeUrl?, crypto?: { address, label, uri } }
//
// Only configured methods are returned, so each shows up on /order once you set
// its env var (and disappears if you unset it). All values are public by nature
// (they're how people pay you), so there are no secrets here.
//   TIP_VENMO            -> Venmo username (with or without @)
//   TIP_VENMO_NOTE       -> note prefilled on the Venmo payment (default "Coffee tip")
//   TIP_STRIPE_URL       -> a Stripe Payment Link URL (TIP_STRIPE_LINK also accepted)
//   TIP_CRYPTO_ADDRESS   -> a wallet address
//   TIP_CRYPTO_LABEL     -> e.g. "ETH" / "Bitcoin" (display)
//   TIP_CRYPTO_URI       -> optional payment URI, e.g. "ethereum:0x…" / "bitcoin:bc1…"
// -----------------------------------------------------------------------------

const clean = (v) => (v && String(v).trim() ? String(v).trim() : "");

export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=60");

  const cfg = {};

  const venmo = clean(process.env.TIP_VENMO).replace(/^@/, "");
  if (venmo) {
    cfg.venmo = venmo;
    cfg.venmoNote = clean(process.env.TIP_VENMO_NOTE) || "Coffee tip";
  }

  const stripe = clean(process.env.TIP_STRIPE_URL) || clean(process.env.TIP_STRIPE_LINK);
  if (/^https?:\/\//i.test(stripe)) cfg.stripeUrl = stripe;

  const address = clean(process.env.TIP_CRYPTO_ADDRESS);
  if (address) {
    const uri = clean(process.env.TIP_CRYPTO_URI);
    cfg.crypto = {
      address,
      label: clean(process.env.TIP_CRYPTO_LABEL) || "Crypto",
      uri: uri.includes(":") ? uri : "",
    };
  }

  res.statusCode = 200;
  res.end(JSON.stringify(cfg));
}
