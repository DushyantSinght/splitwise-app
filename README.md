# SplitRight — Shared Expenses App

A full-stack shared expenses tracker built for a flatmate group, with CSV import, multi-currency support, temporal group membership, and a deliberate anomaly-handling pipeline.

## AI Tool Used
- **Claude (Anthropic)** — primary development collaborator for architecture, code generation, and anomaly analysis

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL (relational, as required) |
| Auth | JWT (bcryptjs) |
| CSV Parsing | csv-parse |
| Deployment | Render (backend) + Vercel (frontend) |

---

## Local Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ (or a free Neon/Supabase instance)

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/splitwise-app.git
cd splitwise-app
```

### 2. Database setup

Create a PostgreSQL database and run the schema:

```bash
psql -U postgres -c "CREATE DATABASE splitwise;"
psql -U postgres -d splitwise -f backend/src/db/schema.sql
```

Or with a connection string:
```bash
psql "postgresql://user:pass@host/splitwise" -f backend/src/db/schema.sql
```

**Free cloud options:**
- [Neon](https://neon.tech) — serverless Postgres, free tier
- [Supabase](https://supabase.com) — free tier with 500MB

### 3. Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your DATABASE_URL and a strong JWT_SECRET
npm install
npm run dev
# Server starts on http://localhost:4000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
# App starts on http://localhost:5173
```

### 5. Import the CSV

1. Register an account at `http://localhost:5173/register`
2. Go to **Import CSV** in the sidebar
3. Upload `expenses_export.csv`
4. Review the anomaly report — all 15+ issues are detected and surfaced
5. Go to **Pending Reviews** to approve/reject flagged items

---

## Deployment

### Backend — Render
1. Push to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Set root directory to `backend/`
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`

### Frontend — Vercel
1. Create a new project on [Vercel](https://vercel.com)
2. Set root directory to `frontend/`
3. Add environment variable: `VITE_API_URL=https://your-render-url.onrender.com/api`

---

## Key Design Decisions

See `DECISIONS.md` for the full decision log.

## Data Anomalies

See `SCOPE.md` for the complete anomaly log and database schema.

## AI Usage

See `AI_USAGE.md` for prompts, corrections, and AI collaboration notes.
