require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();

// Security: Only allow requests from your domain in production
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://goodnews.news', 'https://www.goodnews.news']
  : ['http://localhost:8080', 'http://localhost:3000', 'http://127.0.0.1:8080'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl) only in development
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '10kb' })); // Limit body size

// Rate limiting: 10 signups per IP per hour (prevents spam/abuse)
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many signups from this IP, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting: 100 requests per IP per 15 minutes (general)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
});

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// News API endpoint
const NEWS_API_KEY = process.env.NEWS_API_KEY;

// Email validation regex
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

// Sanitize interests (only allow alphanumeric and common chars)
const sanitizeInterests = (interests) => {
  if (!Array.isArray(interests)) return [];
  return interests
    .slice(0, 10) // Max 10 interests
    .map(i => String(i).toLowerCase().replace(/[^a-z0-9\s-]/g, '').slice(0, 50))
    .filter(i => i.length > 0);
};

// Signup endpoint with rate limiting
app.post('/api/signup', signupLimiter, async (req, res) => {
  try {
    const { email, interests, timezone } = req.body;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Sanitize and validate interests
    const cleanInterests = sanitizeInterests(interests);
    if (cleanInterests.length === 0) {
      return res.status(400).json({ error: 'At least one interest required' });
    }

    // Validate timezone (basic check)
    const cleanTimezone = String(timezone || 'America/New_York').slice(0, 50);

    // Check if email already exists
    const { data: existing } = await supabase
      .from('subscribers')
      .select('email')
      .eq('email', email)
      .single();

    if (existing) {
      // Update interests if already subscribed
      const { error } = await supabase
        .from('subscribers')
        .update({ interests: cleanInterests, timezone: cleanTimezone, updated_at: new Date().toISOString() })
        .eq('email', email);

      if (error) throw error;
      return res.json({ message: 'Preferences updated successfully!' });
    }

    // Insert new subscriber
    const { error } = await supabase
      .from('subscribers')
      .insert([{
        email,
        interests: cleanInterests,
        timezone: cleanTimezone,
        created_at: new Date().toISOString()
      }]);

    if (error) throw error;

    // Send welcome email
    await sendWelcomeEmail(email, cleanInterests);

    res.json({ message: 'Successfully subscribed!' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to subscribe. Please try again.' });
  }
});

// Fetch good news based on interests
async function fetchGoodNews(interests) {
  const newsItems = [];

  // Keywords that indicate genuinely positive news
  const positiveKeywords = [
    'breakthrough', 'success', 'achieve', 'discover', 'innovate',
    'cure', 'saves', 'helped', 'donate', 'volunteer', 'milestone',
    'renewable', 'sustainable', 'recovery', 'celebrates', 'award',
    'research finds', 'scientists discover', 'new study', 'progress'
  ];

  // Spam/negative keywords to exclude
  const excludeKeywords = [
    'casino', 'gambling', 'bet', 'poker', 'slots', 'free spins',
    'death', 'dead', 'kill', 'murder', 'crash', 'disaster', 'tragedy',
    'war', 'attack', 'terror', 'bomb', 'shooting', 'violence',
    'scandal', 'fraud', 'scam', 'accused', 'arrest', 'prison',
    'crypto', 'bitcoin', 'nft', 'forex', 'trading signals',
    'weight loss', 'diet pill', 'supplement', 'cbd', 'thc',
    'click here', 'limited time', 'act now', 'buy now', 'discount',
    'sponsored', 'advertisement', 'promoted', 'partner content',
    'globenewswire', 'prnewswire', 'businesswire', 'accesswire'
  ];

  // Trusted news sources
  const trustedSources = [
    'bbc', 'npr', 'reuters', 'associated press', 'the guardian',
    'new york times', 'washington post', 'wired', 'ars technica',
    'the verge', 'techcrunch', 'nature', 'science', 'national geographic',
    'smithsonian', 'cnn', 'abc news', 'cbs news', 'nbc news', 'time',
    'forbes', 'bloomberg', 'espn', 'sports illustrated'
  ];

  // Get today's date for filtering recent news
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const fromDate = yesterday.toISOString().split('T')[0];

  // Map interests to NewsAPI categories
  const categoryMap = {
    'tech': 'technology',
    'technology': 'technology',
    'science': 'science',
    'health': 'health',
    'sports': 'sports',
    'business': 'business',
    'entertainment': 'entertainment',
    'arts': 'entertainment'
  };

  for (const interest of interests.slice(0, 3)) {
    try {
      const category = categoryMap[interest.toLowerCase()];
      let response;

      if (category) {
        // Use top-headlines for mapped categories (breaking news)
        response = await fetch(
          `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=20&country=us`,
          { headers: { 'X-Api-Key': NEWS_API_KEY } }
        );
      } else {
        // Fall back to everything with date filter for other interests
        response = await fetch(
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(interest)}&language=en&sortBy=publishedAt&from=${fromDate}&pageSize=20`,
          { headers: { 'X-Api-Key': NEWS_API_KEY } }
        );
      }

      const data = await response.json();

      if (data.articles) {
        const goodArticles = data.articles.filter(article => {
          if (!article.title || !article.description) return false;

          const text = `${article.title} ${article.description}`.toLowerCase();
          const source = (article.source?.name || '').toLowerCase();

          // Must have positive indicator
          const hasPositive = positiveKeywords.some(kw => text.includes(kw));

          // Must NOT have spam/negative content
          const hasExcluded = excludeKeywords.some(kw => text.includes(kw) || source.includes(kw));

          // Prefer trusted sources (but don't require)
          const isTrusted = trustedSources.some(s => source.includes(s));

          // Filter: must be positive, not excluded, prefer trusted
          return hasPositive && !hasExcluded;
        });

        // Sort trusted sources first
        goodArticles.sort((a, b) => {
          const aSource = (a.source?.name || '').toLowerCase();
          const bSource = (b.source?.name || '').toLowerCase();
          const aTrusted = trustedSources.some(s => aSource.includes(s));
          const bTrusted = trustedSources.some(s => bSource.includes(s));
          return bTrusted - aTrusted;
        });

        newsItems.push(...goodArticles.slice(0, 2).map(article => ({
          title: article.title,
          description: article.description,
          url: article.url,
          source: article.source.name,
          image: article.urlToImage,
          category: interest
        })));
      }
    } catch (error) {
      console.error(`Error fetching news for ${interest}:`, error);
    }
  }

  return newsItems;
}

// Generate email HTML
function generateEmailHTML(news, interests) {
  const newsHTML = news.map(item => `
    <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #2a2a2a;">
      <span style="display: inline-block; padding: 4px 12px; background: #00d4aa; color: #0f0f0f; border-radius: 50px; font-size: 12px; font-weight: 600; margin-bottom: 12px;">${item.category}</span>
      <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #ffffff;">
        <a href="${item.url}" style="color: #ffffff; text-decoration: none;">${item.title}</a>
      </h2>
      <p style="margin: 0; color: #888; font-size: 14px; line-height: 1.6;">${item.description || ''}</p>
      <p style="margin: 12px 0 0 0; font-size: 12px; color: #666;">Source: ${item.source}</p>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; width: 40px; height: 40px; background: #00d4aa; border-radius: 8px; line-height: 40px; font-size: 24px; color: #0f0f0f; font-weight: bold;">+</div>
          <h1 style="margin: 16px 0 0 0; color: #ffffff; font-size: 24px;">Your Daily GoodNews</h1>
          <p style="margin: 8px 0 0 0; color: #888; font-size: 14px;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div style="background: #141414; border: 1px solid #2a2a2a; border-radius: 16px; padding: 24px;">
          ${newsHTML || '<p style="color: #888; text-align: center;">No news available today. Check back tomorrow!</p>'}
        </div>

        <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #2a2a2a;">
          <p style="color: #666; font-size: 12px; margin: 0;">
            You're receiving this because you subscribed to GoodNews.news<br>
            Interests: ${interests.join(', ')}
          </p>
          <p style="margin: 16px 0 0 0;">
            <a href="https://goodnews.news/unsubscribe" style="color: #00d4aa; font-size: 12px;">Unsubscribe</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Send welcome email
async function sendWelcomeEmail(email, interests) {
  try {
    await resend.emails.send({
      from: 'GoodNews <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to GoodNews! 🌟',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="display: inline-block; width: 48px; height: 48px; background: #00d4aa; border-radius: 8px; line-height: 48px; font-size: 28px; color: #0f0f0f; font-weight: bold;">+</div>
              <h1 style="margin: 16px 0 0 0; color: #ffffff; font-size: 28px;">Welcome to GoodNews!</h1>
            </div>

            <div style="background: #141414; border: 1px solid #2a2a2a; border-radius: 16px; padding: 32px; text-align: center;">
              <p style="color: #ffffff; font-size: 18px; margin: 0 0 16px 0;">You're all set! 🎉</p>
              <p style="color: #888; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                Every morning at 7:30 AM, you'll receive a personalized digest of positive news about:
              </p>
              <div style="margin-bottom: 24px;">
                ${interests.map(i => `<span style="display: inline-block; padding: 8px 16px; background: #1a1a1a; border: 1px solid #00d4aa; color: #00d4aa; border-radius: 50px; font-size: 14px; margin: 4px;">${i}</span>`).join('')}
              </div>
              <p style="color: #888; font-size: 14px; margin: 0;">
                Get ready to start your days feeling inspired and informed.
              </p>
            </div>

            <p style="text-align: center; color: #666; font-size: 12px; margin-top: 32px;">
              © 2025 GoodNews.news - Spreading positivity, one story at a time.
            </p>
          </div>
        </body>
        </html>
      `
    });
    console.log(`Welcome email sent to ${email}`);
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
}

// Send daily digest to a subscriber
async function sendDailyDigest(subscriber) {
  try {
    const news = await fetchGoodNews(subscriber.interests);

    if (news.length === 0) {
      console.log(`No news found for ${subscriber.email}, skipping...`);
      return;
    }

    await resend.emails.send({
      from: 'GoodNews <onboarding@resend.dev>',
      to: subscriber.email,
      subject: `Your Daily GoodNews - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ☀️`,
      html: generateEmailHTML(news, subscriber.interests)
    });

    console.log(`Daily digest sent to ${subscriber.email}`);
  } catch (error) {
    console.error(`Error sending digest to ${subscriber.email}:`, error);
  }
}

// Get subscribers who should receive email at current time
async function getSubscribersForCurrentHour() {
  const { data: subscribers, error } = await supabase
    .from('subscribers')
    .select('*');

  if (error) {
    console.error('Error fetching subscribers:', error);
    return [];
  }

  // Filter subscribers whose local time is 7:30 AM
  const now = new Date();
  return subscribers.filter(sub => {
    try {
      const subscriberTime = new Date(now.toLocaleString('en-US', { timeZone: sub.timezone }));
      return subscriberTime.getHours() === 7 && subscriberTime.getMinutes() >= 30 && subscriberTime.getMinutes() < 45;
    } catch {
      return false;
    }
  });
}

// Schedule daily digest - runs every 15 minutes to catch different timezones
cron.schedule('*/15 * * * *', async () => {
  console.log('Checking for subscribers to send daily digest...');
  const subscribers = await getSubscribersForCurrentHour();

  for (const subscriber of subscribers) {
    await sendDailyDigest(subscriber);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test email endpoint (DEVELOPMENT ONLY - disabled in production)
app.post('/api/test-digest', generalLimiter, async (req, res) => {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test endpoint disabled in production' });
  }

  try {
    const { email, interests } = req.body;

    // Validate email even in test
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const cleanInterests = sanitizeInterests(interests);
    console.log(`Fetching news for interests: ${cleanInterests.join(', ') || 'technology, science'}`);

    const news = await fetchGoodNews(interests || ['technology', 'science']);
    console.log(`Found ${news.length} articles`);

    if (news.length === 0) {
      return res.json({
        message: 'No articles found',
        newsCount: 0,
        articles: [],
        note: 'NewsAPI may have rate limited or no positive news matched'
      });
    }

    const emailResult = await resend.emails.send({
      from: 'GoodNews <onboarding@resend.dev>',
      to: email,
      subject: `Test Daily GoodNews ☀️`,
      html: generateEmailHTML(news, interests || ['technology', 'science'])
    });

    console.log('Email sent:', emailResult);

    res.json({
      message: 'Test email sent!',
      newsCount: news.length,
      articles: news.map(a => ({ title: a.title, source: a.source, category: a.category })),
      emailId: emailResult?.data?.id
    });
  } catch (error) {
    console.error('Test digest error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
