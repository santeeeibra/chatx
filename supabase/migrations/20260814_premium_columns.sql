-- Add premium subscription columns to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS premium_until        timestamptz,
  ADD COLUMN IF NOT EXISTS ccbill_subscription_id text;

-- Index for fast webhook lookups by email
CREATE INDEX IF NOT EXISTS user_profiles_email_idx ON user_profiles (email);
