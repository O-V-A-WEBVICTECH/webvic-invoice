# 🚀 InvoiceFlow - Production-Ready SaaS

A complete, production-ready invoice generator and payment tracker SaaS built with Node.js, Express, Supabase, and Stripe.

## 📋 Features

### Core Features
- ✅ User authentication with JWT (register, login, password reset)
- ✅ Client management (CRUD operations)
- ✅ Invoice creation with multiple line items
- ✅ Professional PDF invoice generation
- ✅ Email invoices directly to clients
- ✅ Payment tracking and reminders
- ✅ Dashboard with analytics

### Payments & Subscriptions
- ✅ Stripe integration for subscriptions
- ✅ Multiple pricing tiers (Free, Pro, Business)
- ✅ Invoice payments via Stripe
- ✅ Webhook handling for payment events
- ✅ Billing history

### Security
- ✅ Bcrypt password hashing
- ✅ JWT authentication with refresh tokens
- ✅ Rate limiting
- ✅ Helmet security headers
- ✅ Input validation & XSS protection
- ✅ CORS configuration
- ✅ Audit logging

## 🛠 Tech Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express.js |
| **Database** | Supabase (PostgreSQL) |
| **Authentication** | JWT + bcrypt |
| **Payments** | Stripe |
| **Email** | Resend / Nodemailer |
| **PDF Generation** | PDFKit |

## 📦 Project Structure

```
invoiceflow/
├── config/
│   └── database.js        # Supabase configuration
├── database/
│   └── schema.sql         # Database schema
├── middleware/
│   ├── auth.js            # JWT authentication
│   ├── errorHandler.js    # Error handling
│   ├── logger.js          # Request logging
│   └── validate.js        # Input validation
├── routes/
│   ├── auth.js            # Authentication routes
│   ├── users.js           # User profile routes
│   ├── clients.js         # Client CRUD routes
│   ├── invoices.js        # Invoice CRUD routes
│   ├── payments.js        # Stripe payment routes
│   └── webhooks.js        # Stripe webhook handlers
├── services/
│   ├── emailService.js    # Email sending
│   └── pdfService.js      # PDF generation
├── public/
│   └── index.html         # Frontend application
├── .env.example           # Environment variables template
├── package.json           # Dependencies
├── server.js              # Main server file
└── README.md              # This file
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)
- Stripe account (test mode for development)
- Resend account (optional, for emails)

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/yourusername/invoiceflow.git
cd invoiceflow

# Install dependencies
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the contents of `database/schema.sql`
3. Copy your project URL and keys from Settings > API

### 3. Set Up Stripe

1. Create account at [stripe.com](https://stripe.com)
2. Get your API keys from Developers > API Keys
3. Create products and prices for your plans:
   - Pro Monthly ($9/month)
   - Pro Yearly ($84/year)
   - Business Monthly ($29/month)
   - Business Yearly ($276/year)
4. Set up webhook endpoint: `https://yourdomain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`, `payment_intent.succeeded`

### 4. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Required environment variables:
```env
# Server
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3000

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# JWT
JWT_SECRET=your-32-character-secret-key-here

# Stripe
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_PRO_YEARLY=price_xxxxx
STRIPE_PRICE_BUSINESS_MONTHLY=price_xxxxx
STRIPE_PRICE_BUSINESS_YEARLY=price_xxxxx

# Email (Resend)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=invoices@yourdomain.com
```

### 5. Run the Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

Server will start at `http://localhost:3000`

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create new account |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | User logout |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/profile` | Get user profile |
| PUT | `/api/users/profile` | Update profile |
| PUT | `/api/users/password` | Change password |
| GET | `/api/users/dashboard-stats` | Get dashboard statistics |

### Clients
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clients` | List all clients |
| GET | `/api/clients/:id` | Get single client |
| POST | `/api/clients` | Create client |
| PUT | `/api/clients/:id` | Update client |
| DELETE | `/api/clients/:id` | Delete client |

### Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/invoices` | List all invoices |
| GET | `/api/invoices/stats` | Get invoice statistics |
| GET | `/api/invoices/:id` | Get single invoice |
| POST | `/api/invoices` | Create invoice |
| PUT | `/api/invoices/:id` | Update invoice |
| DELETE | `/api/invoices/:id` | Delete invoice |
| POST | `/api/invoices/:id/send` | Send invoice via email |
| POST | `/api/invoices/:id/remind` | Send payment reminder |
| POST | `/api/invoices/:id/mark-paid` | Mark as paid |
| GET | `/api/invoices/:id/pdf` | Download PDF |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payments/create-checkout-session` | Create Stripe checkout |
| GET | `/api/payments/subscription` | Get subscription status |
| POST | `/api/payments/cancel-subscription` | Cancel subscription |
| GET | `/api/payments/billing-history` | Get billing history |

## 🚢 Deployment

### Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

### Deploy to Render

1. Connect your GitHub repository
2. Create a new Web Service
3. Set environment variables
4. Deploy

## 📈 Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong JWT_SECRET (32+ characters)
- [ ] Enable Stripe live mode
- [ ] Set up proper domain for emails
- [ ] Configure CORS for your domain
- [ ] Set up monitoring (Sentry, LogRocket)
- [ ] Enable Supabase Row Level Security
- [ ] Set up database backups
- [ ] Configure rate limiting for production
- [ ] Add SSL certificate

## 💰 Revenue Model

| Plan | Price | Features |
|------|-------|----------|
| **Free** | $0/mo | 5 invoices/month, 2 clients |
| **Pro** | $9/mo | Unlimited invoices, auto-reminders, recurring invoices |
| **Business** | $29/mo | Everything + team members, white-label, API access |

## 📄 License

MIT License - feel free to use for personal or commercial projects.

## 🤝 Support

- 📧 Email: support@invoiceflow.com
- 📖 Docs: https://docs.invoiceflow.com
- 🐛 Issues: GitHub Issues

---

Built with ❤️ by Webvictech Team
