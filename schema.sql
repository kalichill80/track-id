CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  target_url TEXT NOT NULL,
  campaign TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS clicks (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES tokens(token) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  clicked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ip TEXT,
  user_agent TEXT,
  referer TEXT,
  is_prefetch BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_clicks_token ON clicks(token);
CREATE INDEX IF NOT EXISTS idx_tokens_campaign ON tokens(campaign);
