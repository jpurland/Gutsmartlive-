-- Research studies pulled from PubMed
CREATE TABLE IF NOT EXISTS research (
  pmid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  journal TEXT,
  pub_date TEXT,
  authors TEXT,
  topic TEXT,
  url TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_added ON research(added_at DESC);

-- Log of each automatic research pull
CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  found INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

-- Newsletter subscribers
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Community stories (held for approval)
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'mixed',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status, created_at DESC);

-- Comments on approved stories (also held for approval)
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL REFERENCES stories(id),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id, status);

-- Private settings (admin password hash, email keys). Never exposed by the API.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
