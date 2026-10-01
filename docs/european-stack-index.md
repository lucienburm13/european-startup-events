# European Stack Index v0.1

A small, transparent indicator for how European the primary technology stack of a digital product is.

This is **EuroStack-inspired**, but is not an official EuroStack methodology or score.

## Seven application layers

1. Domain & DNS
2. Hosting & compute
3. Data & storage
4. Software & runtime
5. Functional services (maps, forms, search, email, payments, etc.)
6. Analytics & observability
7. AI & automation

The list is intentionally application-oriented. It avoids pretending that a small web product can reliably audit the chips, cables and physical infrastructure beneath every cloud service.

## Layer classifications

- **European** — the primary provider controlling the layer is headquartered and controlled in Europe.
- **Non-European** — the primary provider controlling the layer is headquartered and controlled outside Europe.
- **Open** — the primary layer is based on open standards/open-source technology without meaningful geographic ownership. Open does not count as European ownership, but is shown because it improves portability and reduces lock-in.
- **Mixed** — control is materially shared across European and non-European providers. In future versions this may receive a half-weight.
- **Pending** — the layer has not yet been selected or verified.

## v0.1 score

`European Stack % = European layers / all seven layers × 100`

Pending and Open layers remain in the denominator. This deliberately avoids inflating the European score simply because a layer is undecided or open source.

The page should always show the underlying providers and flags next to the percentage so the score is auditable.

## Future sovereignty score

A later version can add a separate weighted sovereignty score using dimensions inspired by EuroStack procurement work: jurisdiction/governance, technical control, operational control, data control/residency and economic value creation. That should remain separate from the deliberately simple layer percentage.
