# Clearr Budgeting

> "Finances filtered. No sugar added."

A no-nonsense personal finance tracker packaged as a native Android app. Tracks spending, visualizes cash flow, and tells you the truth — even when it stings.

## Screenshots

*(Add screenshots of welcome screen, dashboard, transactions, and analytics here)*

## Features

- **Dashboard** — Half-donut chart of budget usage, cash flow ratio, daily allowance, spending trends
- **Transactions** — Add, search, filter, and categorize expenses and income with bottom-sheet UI
- **Analytics** — Income vs. expenses, cash flow charts, category breakdown, month-over-month comparison
- **Budget Rules** — 50/30/20-style budget targets with tolerance-based alerting
- **Onboarding** — Multi-step setup with income input, financial literacy quiz, goal setting, and commitment ring
- **AI Insights** — Financial health score with personalized tips based on spending patterns
- **MFA / TOTP** — Two-factor authentication enrollment with QR code and recovery codes
- **Push Notifications** — Budget alerts, large-transaction warnings, and weekly summaries
- **Dark Mode** — System-aware theme toggle, persisted across sessions
- **Data Export** — Export your transaction history as CSV

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS, Vite, CSS Custom Properties |
| Mobile | Capacitor 8 (Android + iOS) |
| Backend | Supabase (PostgreSQL, Auth, Realtime) |
| Serverless | Vercel API Functions (TypeScript) |
| Auth | Email/password, Google OAuth, TOTP MFA |
| Icons | Phosphor Icons |
| Fonts | Inter, DM Serif Display |
| Encryption | AES-256-GCM via PBKDF2 (100K iterations) |

## Getting Started

### Prerequisites

- Node.js 20+
- Android Studio (for Android builds)
- A Supabase project (free tier works)
- A Vercel account (for API functions and cron jobs)

### Setup

```bash
# Clone the repo
git clone https://github.com/DavidZrubec/clearr-budgeting-app.git
cd clearr-budgeting-app

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Supabase URL, anon key, and service role key
```

### Environment Variables

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Development

```bash
# Start Vite dev server
npm run dev
```

### Android Build

```bash
# Sync Capacitor with the web build
npx cap sync android

# Build the APK (applies MIME type patch automatically via postinstall)
cd android
./gradlew assembleDebug

# Install on connected device/emulator
adb install app/build/outputs/apk/debug/app-debug.apk
```

The `postinstall` script automatically applies a patch to Capacitor's `WebViewLocalServer.java` to fix a known issue where `.js` and `.mjs` files get incorrect MIME types (preventing ES module loading on Android WebView).

### iOS Build

```bash
npx cap sync ios
npx cap open ios
# Build and run from Xcode
```

### Deploy to Vercel

```bash
# Deploy API functions and static assets
npx vercel --prod
```

Vercel cron jobs handle:
- **Daily (6:00 AM)** — Process recurring transactions
- **Weekly (Monday 7:00 AM)** — Check budget limits and send alerts

## Architecture

```
clearr-budgeting-app/
├── public/
│   └── script.js            # Main application logic (3.3k lines)
├── src/
│   ├── main.js              # Module entry point (sets up window.supabase)
│   ├── supabase.js          # Supabase client + session encryption
│   └── db.js                # Database helpers
├── api/
│   ├── _lib/
│   │   ├── auth.ts          # Cron & webhook verification
│   │   ├── supabase.ts      # Server-side Supabase admin client
│   │   └── notify.ts        # Push notification helpers
│   ├── recurring.ts         # Daily recurring transactions (Vercel cron)
│   ├── budget-alerts.ts     # Weekly budget limit alerts (Vercel cron)
│   └── transaction-created.ts # Webhook handler for new transactions
├── android/                 # Capacitor Android project
├── supabase/
│   └── migrations/          # Database migrations (RLS policies, triggers)
├── scripts/
│   └── patch-capacitor-mime.js  # Fixes .js/.mjs MIME type on Android
├── index.html               # Single-page app shell (769 lines)
├── styles.css               # Complete stylesheet (2.8k lines)
├── vite.config.js           # Vite config with crossorigin removal
├── capacitor.config.json    # Capacitor config (app ID, Google Auth)
└── vercel.json              # Vercel config (CSP, rewrites, cron, functions)
```

### Security

- **Content Security Policy** — Strict CSP headers enforced via `vercel.json`
- **Session Encryption** — Auth tokens encrypted with AES-256-GCM before storage (PBKDF2 with 100K iterations)
- **Rate Limiting** — Exponential backoff with database-backed rate limit log
- **API Auth** — HMAC-SHA256 webhook verification and Vercel cron origin checks
- **Password Policy** — Minimum 8 chars with uppercase, lowercase, digit, and special character validation
- **Email Verification** — Dashboard gated behind `email_confirmed_at` check
- **RLS** — All database tables protected with Row-Level Security policies

## Database Schema

The Supabase migration (`supabase/migrations/001_init.sql`) includes:

- `user_profiles` — Extended user data with auto-creation on signup
- `transactions` — Core transaction records with RLS
- `recurring_transactions` — Configurable recurring expense/income rules
- `budget_alerts` — Generated alert records
- Multi-factor authentication (TOTP) support

## License

Private — all rights reserved.
