-- 021_ai_index: hot-path indexes for the AI tutor conversation reads and
-- retention purges. Additive only; safe to re-run (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created ON ai_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at);
