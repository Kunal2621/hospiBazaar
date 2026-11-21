# Hospi Bazaar

B2B healthcare procurement platform for hospital furniture and medical equipment. Stack from the working document (§16): **Node.js (Express) + React + MySQL + Razorpay**.

```
db/        SQL migrations (9) and the migration runner
server/    Node.js REST API (routes, services, background jobs, tests)
client/    React (Vite) web app
```

## What is built

| Area | What it does |
|---|---|
| Accounts | Hospital and supplier registration with versioned Terms, login (JWT), roles for hospital users, supplier users and four admin roles |
| Verification | Supplier checklist review (§19), light hospital verification before the first order (decision 7) |
| Catalogue | Supplier product listing with photos, documents and specifications; admin approval; public marketplace with search, filters, sorting and product pages |
| RFQ | Hospital sends an RFQ, matching verified suppliers quote, side-by-side comparison, accept to create the order |
| Negotiation and cart | Counter-offers on items above ₹5,000, agreed price held in the cart for 72 hours, fixed quantity, auto-close after 7 quiet days |
| Orders | Supplier confirms, hospital pays, supplier dispatches with invoice, delivery and installation confirmation, auto-confirmation, cancellation |
| Payments | Razorpay checkout with signature verification and webhook; **mock mode** when no keys are set |
| Online limit | Carts and quotations above ₹5,00,000 become a manual-order request; admin creates the order and records bank payments (can be staged) |
| Payouts | Funds held until delivery (and installation) is confirmed; platform fee deducted; admin releases with a bank reference |
| Disputes | Hospital reports a problem, payout is held, admin releases, refunds or closes |
| Warranty and service | Warranty created on completion, serial number and installation date, service tickets (HB-SR-…) with updates |
| Notifications | In-app bell for every event; email too if SMTP is configured |
| GST | CGST + SGST or IGST worked out from supplier and delivery state, shown on every order |
| Admin | Overview counts, product approval, orders, manual orders, payouts, disputes, platform settings |

Tests: 13 API tests against a real database cover registration through payout, warranty and service, negotiation and cart, the online limit, disputes, auto-confirmation and settings. The whole flow was also walked through in a headless browser at desktop and 390px widths with no console errors.

## Setup

Needs Node 20+ and MySQL 8.

```bash
cp .env.example .env              # set DB_USER / DB_PASSWORD, and JWT_SECRET for production
npm install && npm run db:migrate

cd server && npm install
npm run create-admin -- --email you@example.com --name "Your Name" --mobile 9876543210 --password 'Str0ngPass1' --role super_admin
npm run dev                       # API on http://localhost:4000

cd ../client && npm install
npm run dev                       # web app on http://localhost:5173
```

To try everything yourself, you need five accounts: the admin above, a hospital (register at `/register/hospital`, then ask for verification), and a supplier (register at `/register/supplier`). As admin, verify both under Suppliers and Hospitals, approve the supplier's product under Product approval, and you can place orders. With no Razorpay keys, paying shows a "Simulate payment" button.

## Tests

```bash
DB_USER=... DB_PASSWORD=... DB_NAME=hospi_bazaar_test node db/migrate.js --fresh   # from repo root
cd server && DB_USER=... DB_PASSWORD=... DB_NAME=hospi_bazaar_test npm test
```

Use a separate database: `--fresh` drops it.

## Changing things to suit you

### Business rules (no code change)
Admin panel → Settings (super admin only). Stored in `platform_settings`:

| Setting | Default | Meaning |
|---|---|---|
| `online_order_cap` | 500000 | Orders above this are arranged by the team (decision 2) |
| `negotiation_min_unit_price` | 5000 | Items priced above this can be negotiated |
| `negotiation_inactivity_days` | 7 | A quiet negotiation closes after this many days |
| `price_lock_hours` | 72 | How long an agreed price stays in the cart |
| `delivery_auto_confirm_days` | 7 | Delivery or installation confirms itself after this |
| `platform_fee_percent` | 3.00 | Charged on the goods value before GST, taken from the supplier payout |
| `default_gst_rate` | 12 | Suggested when a supplier adds a product |
| `rfq_default_quote_days` | 7 | Quote deadline when the hospital does not choose one |
| `online_cap_message`, `dispute_window_note` | text | Messages shown to buyers |

### Configuration (`.env`)
`DB_*`, `PORT`, `CLIENT_ORIGIN`, `JWT_SECRET`, `RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET`, `SMTP_HOST / PORT / USER / PASS / FROM`, `UPLOADS_DIR`, `MAX_UPLOAD_MB`, `RUN_JOBS`. See `.env.example`.

**Real payments:** set the three Razorpay values. In the Razorpay dashboard point the webhook at `https://your-domain/api/payments/webhook` for `payment.captured` and `payment.failed`. The checkout script loads from checkout.razorpay.com, so if you serve the app behind a strict Content-Security-Policy, allow that host.

### Where the code lives
| To change… | Edit |
|---|---|
| Order steps, payouts, warranty creation, refunds | `server/src/services/orders.js` |
| GST maths, totals | `server/src/services/money.js` |
| Where uploaded files go (for example S3) | `server/src/services/storage.js` (same three functions) |
| Payment gateway | `server/src/services/payments.js` |
| Who gets which notification, and by what channel | `server/src/services/notify.js` |
| Background jobs and how often they run | `server/src/jobs.js` (every 5 minutes) |
| API endpoints | `server/src/routes/*.js`, mounted in `server/src/app.js` |
| Database changes | add `db/migrations/010_….sql` (forward-only) |
| Colours, fonts, spacing | tokens at the top of `client/src/styles/base.css` |
| Screens | `client/src/pages/` (`shared/` is used by more than one role), menus in `client/src/components/layouts.jsx`, routes in `client/src/App.jsx` |

### Roles
Hospital: hospital admin, purchase manager and purchase executive can buy; biomedical engineer can also confirm delivery; doctor can browse. Admin: `super_admin` (everything, plus settings), `verifier`, `catalog_manager` (product approval), `support` (orders, manual orders, payouts, disputes).

## Defaults I chose where the document left a question open

Change any of these if they do not fit.

- **File storage:** local disk (`server/uploads`), served at `/uploads`. Files have unguessable names but are not access-controlled. Swap `storage.js` for S3 before launch.
- **Payments:** real Razorpay when keys are set, otherwise a clearly labelled test mode that moves no money.
- **Notifications:** in-app always; email only when SMTP is set. SMS and WhatsApp are not connected.
- **GST:** CGST+SGST or IGST is calculated and shown. There is no e-invoicing or GST return export. Freight, installation and service charges are treated as GST-inclusive.
- **Staged payments** (for large equipment) exist only for team-created orders, recorded by an admin.
- **Logistics:** carrier name, tracking number and dates only. No courier API.
- **Payout:** fee is `platform_fee_percent` of the goods value before GST. The platform does not move money; the admin pays the supplier from the bank and records the reference.
- **Supplier confirmation:** a team-created order skips it, since the team arranged it.

## Known limits before a real launch

- Tested on MariaDB 10.11, not MySQL 8 itself. The SQL is standard, but run the tests on your MySQL.
- Login tokens are kept in the browser's local storage. Consider httpOnly cookies and refresh tokens.
- Terms documents (`terms_versions.document_url`) point at example.com.
- Admin accounts cannot self-register; use `npm run create-admin`.
- No password reset or email verification flow yet.
- Not tested on real phones, Safari or Firefox, or under load. Not reviewed by a lawyer, accountant or security specialist; marketplace payment flows have tax and RBI implications you should check.
- Still open from the document: logistics design (§21), e-invoicing and GST filing (§22), hosting.

## API summary

Public: `GET /api/products`, `/api/products/:slug`, `/api/categories`, `/api/brands`, `/api/terms/:audience`; `POST /api/auth/register/{hospital,supplier}`, `/api/auth/login`.

Signed in (all roles): `/api/notifications`, `/api/orders`, `/api/orders/:id`, `/api/negotiations`, `/api/warranties`, `/api/service-requests`, `/api/summary`, `/api/uploads`.

Hospital: `/api/cart`, `/api/rfqs`, `/api/orders/:id/{pay,cancel,confirm-delivery,confirm-installation,dispute}`, `/api/payments/{verify,mock-capture}`.

Supplier: `/api/supplier/products`, `/api/supplier/rfqs`, `/api/orders/:id/{confirm,reject,dispatch,mark-delivered,mark-installed}`.

Admin: `/api/admin/{suppliers,hospitals,products,manual-requests,orders,payouts,disputes,settings,stats}`.

Razorpay calls `POST /api/payments/webhook`. Errors are JSON: `{ "error": "...", "fields": { "field.name": "message" } }`.
