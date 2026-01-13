import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);
const NEWS_API_KEY = process.env.NEWS_API_KEY;

// Fetch good news
async function fetchGoodNews(interests) {
  const newsItems = [];

  const positiveKeywords = [
    'breakthrough', 'success', 'achieve', 'discover', 'innovate',
    'cure', 'saves', 'helped', 'donate', 'volunteer', 'milestone',
    'renewable', 'sustainable', 'recovery', 'celebrates', 'award',
    'research finds', 'scientists discover', 'new study', 'progress'
  ];

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
        response = await fetch(
          `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=20&country=us`,
          { headers: { 'X-Api-Key': NEWS_API_KEY } }
        );
      } else {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const fromDate = yesterday.toISOString().split('T')[0];
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
          const hasPositive = positiveKeywords.some(kw => text.includes(kw));
          const hasExcluded = excludeKeywords.some(kw => text.includes(kw) || source.includes(kw));
          return hasPositive && !hasExcluded;
        });

        newsItems.push(...goodArticles.slice(0, 2).map(article => ({
          title: article.title,
          description: article.description,
          url: article.url,
          source: article.source.name,
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
            You're receiving this because you subscribed to GoodNews<br>
            Interests: ${interests.join(', ')}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export default async function handler(req, res) {
  // Verify cron secret to prevent unauthorized access
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Running daily digest cron job...');

    // Get all subscribers
    const { data: subscribers, error } = await supabase
      .from('subscribers')
      .select('*');

    if (error) throw error;

    const now = new Date();
    let sentCount = 0;

    // Filter subscribers whose local time is 7:30 AM
    for (const subscriber of subscribers) {
      try {
        const subscriberTime = new Date(now.toLocaleString('en-US', { timeZone: subscriber.timezone }));
        const hour = subscriberTime.getHours();
        const minute = subscriberTime.getMinutes();

        // Send if it's between 7:30-7:45 AM in their timezone
        if (hour === 7 && minute >= 30 && minute < 45) {
          const news = await fetchGoodNews(subscriber.interests);

          if (news.length > 0) {
            await resend.emails.send({
              from: 'GoodNews <onboarding@resend.dev>',
              to: subscriber.email,
              subject: `Your Daily GoodNews - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
              html: generateEmailHTML(news, subscriber.interests)
            });
            sentCount++;
            console.log(`Sent digest to ${subscriber.email}`);
          }
        }
      } catch (err) {
        console.error(`Error processing ${subscriber.email}:`, err);
      }
    }

    res.status(200).json({ message: `Daily digest complete. Sent ${sentCount} emails.` });
  } catch (error) {
    console.error('Cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
