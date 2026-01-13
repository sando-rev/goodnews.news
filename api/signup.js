import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Email validation
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

// Sanitize interests
const sanitizeInterests = (interests) => {
  if (!Array.isArray(interests)) return [];
  return interests
    .slice(0, 10)
    .map(i => String(i).toLowerCase().replace(/[^a-z0-9\s-]/g, '').slice(0, 50))
    .filter(i => i.length > 0);
};

// Generate welcome email HTML
function generateWelcomeHTML(interests) {
  return `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; width: 48px; height: 48px; background: #00d4aa; border-radius: 8px; line-height: 48px; font-size: 28px; color: #0f0f0f; font-weight: bold;">+</div>
          <h1 style="margin: 16px 0 0 0; color: #ffffff; font-size: 28px;">Welcome to GoodNews!</h1>
        </div>
        <div style="background: #141414; border: 1px solid #2a2a2a; border-radius: 16px; padding: 32px; text-align: center;">
          <p style="color: #ffffff; font-size: 18px; margin: 0 0 16px 0;">You're all set!</p>
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
  `;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, interests, timezone } = req.body;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Sanitize inputs
    const cleanInterests = sanitizeInterests(interests);
    if (cleanInterests.length === 0) {
      return res.status(400).json({ error: 'At least one interest required' });
    }

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
      return res.status(200).json({ message: 'Preferences updated successfully!' });
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
    await resend.emails.send({
      from: 'GoodNews <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to GoodNews!',
      html: generateWelcomeHTML(cleanInterests)
    });

    res.status(200).json({ message: 'Successfully subscribed!' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to subscribe. Please try again.' });
  }
}
