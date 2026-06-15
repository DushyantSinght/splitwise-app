-- ============================================================
-- Shared Expenses App - Complete Database Schema
-- ============================================================

-- Users / flat members
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Groups (a flat or trip)
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Group membership with temporal validity (join / leave dates)
CREATE TABLE IF NOT EXISTS group_members (
  id          SERIAL PRIMARY KEY,
  group_id    INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   DATE NOT NULL,
  left_at     DATE,                        -- NULL means still active
  UNIQUE (group_id, user_id, joined_at)   -- allow re-join
);

-- Currencies supported
-- We store a snapshot rate at import time so balances are stable
CREATE TABLE IF NOT EXISTS currencies (
  code        VARCHAR(10) PRIMARY KEY,     -- INR, USD, etc.
  name        VARCHAR(50)
);
INSERT INTO currencies VALUES ('INR','Indian Rupee'),('USD','US Dollar')
ON CONFLICT DO NOTHING;

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id              SERIAL PRIMARY KEY,
  group_id        INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description     VARCHAR(255) NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,    -- in original currency
  currency        VARCHAR(10) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  amount_inr      NUMERIC(12,2) NOT NULL,    -- converted to INR at import time
  fx_rate         NUMERIC(10,6) NOT NULL DEFAULT 1.0,  -- rate used for conversion
  paid_by         INT NOT NULL REFERENCES users(id),
  split_type      VARCHAR(20) NOT NULL,      -- equal | unequal | percentage | share
  expense_date    DATE NOT NULL,
  is_settlement   BOOLEAN DEFAULT FALSE,     -- TRUE for payments between members
  is_deleted      BOOLEAN DEFAULT FALSE,     -- soft delete (Meera approval flow)
  notes           TEXT,
  import_row      INT,                       -- original CSV row for traceability
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Per-person share of each expense
CREATE TABLE IF NOT EXISTS expense_splits (
  id              SERIAL PRIMARY KEY,
  expense_id      INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id         INT NOT NULL REFERENCES users(id),
  share_amount    NUMERIC(12,2) NOT NULL,    -- in INR, what this person owes
  share_pct       NUMERIC(6,2),             -- only set for percentage split
  share_units     NUMERIC(6,2),             -- only set for share/ratio split
  UNIQUE(expense_id, user_id)
);

-- Settlements (who paid whom, how much)
CREATE TABLE IF NOT EXISTS settlements (
  id              SERIAL PRIMARY KEY,
  group_id        INT NOT NULL REFERENCES groups(id),
  paid_by         INT NOT NULL REFERENCES users(id),
  paid_to         INT NOT NULL REFERENCES users(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency        VARCHAR(10) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  settled_at      DATE NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Import audit log: every CSV row and what happened to it
CREATE TABLE IF NOT EXISTS import_log (
  id              SERIAL PRIMARY KEY,
  import_batch    VARCHAR(50) NOT NULL,      -- timestamp-based batch ID
  csv_row         INT NOT NULL,
  raw_data        JSONB NOT NULL,            -- original CSV fields
  status          VARCHAR(20) NOT NULL,      -- imported | flagged | skipped | pending_review
  anomalies       JSONB,                     -- array of {code, message, resolution}
  expense_id      INT REFERENCES expenses(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Pending review items (for Meera's approval flow on deletions)
CREATE TABLE IF NOT EXISTS pending_reviews (
  id              SERIAL PRIMARY KEY,
  import_batch    VARCHAR(50) NOT NULL,
  import_log_id   INT REFERENCES import_log(id),
  review_type     VARCHAR(30) NOT NULL,      -- DELETE_DUPLICATE | SKIP_SETTLEMENT | etc
  description     TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by     INT REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
