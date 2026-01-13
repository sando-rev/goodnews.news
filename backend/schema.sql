-- Run this in Supabase SQL Editor to create the subscribers table

CREATE TABLE subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  interests TEXT[] NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index on email for faster lookups
CREATE INDEX idx_subscribers_email ON subscribers(email);

-- Enable Row Level Security (RLS)
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Create a policy to allow inserts from the API
CREATE POLICY "Allow public inserts" ON subscribers
  FOR INSERT WITH CHECK (true);

-- Create a policy to allow reads from the API (for the scheduled job)
CREATE POLICY "Allow service role reads" ON subscribers
  FOR SELECT USING (true);

-- Create a policy to allow updates (for preference changes)
CREATE POLICY "Allow updates" ON subscribers
  FOR UPDATE USING (true);
