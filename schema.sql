-- Run: wrangler d1 execute dashboard-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS telegram_users (
    chat_id INTEGER PRIMARY KEY,
    user_id TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
