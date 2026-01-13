# GoodNews.news

A personalized positive news digest delivered to your inbox every morning at 7:30 AM.

## Setup Instructions

### 1. Supabase (Database - Free)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Go to **SQL Editor** and run the contents of `backend/schema.sql`
4. Go to **Settings > API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`

### 2. NewsAPI (News Data - Free)

1. Go to [newsapi.org](https://newsapi.org) and create a free account
2. Copy your API key → `NEWS_API_KEY`
3. Free tier: 100 requests/day (enough for daily digests)

### 3. Resend (Email - Free)

1. Go to [resend.com](https://resend.com) and create a free account
2. Add and verify your domain (or use their test domain for development)
3. Create an API key → `RESEND_API_KEY`
4. Free tier: 100 emails/day, 3,000/month

### 4. Configure Environment

```bash
cd backend
cp .env.example .env
# Edit .env with your API keys
```

### 5. Run Locally

```bash
# Terminal 1: Backend
cd backend
npm install
npm run dev

# Terminal 2: Frontend
cd ..
python3 -m http.server 8080
```

Visit http://localhost:8080

## Deployment

### Backend (Render.com - Free)

1. Push code to GitHub
2. Go to [render.com](https://render.com) and create a free account
3. Create a new **Web Service**
4. Connect your GitHub repo, set root directory to `backend`
5. Add environment variables from your `.env`
6. Deploy

### Frontend (GitHub Pages / Vercel / Netlify - Free)

1. Update `API_URL` in `index.html` to your Render backend URL
2. Deploy `index.html` to any static hosting

## Project Structure

```
goodnews.news/
├── index.html          # Landing page
├── backend/
│   ├── server.js       # Express API + cron scheduler
│   ├── schema.sql      # Supabase database schema
│   ├── .env.example    # Environment variables template
│   └── package.json
└── README.md
```

## API Endpoints

- `POST /api/signup` - Subscribe with email + interests
- `GET /api/health` - Health check
- `POST /api/test-digest` - Send test email (dev only)

## How It Works

1. User signs up with email + interests + timezone
2. Welcome email sent immediately via Resend
3. Cron job runs every 15 minutes, checks for users whose local time is 7:30 AM
4. Fetches positive news from NewsAPI based on user interests
5. Sends personalized email digest
