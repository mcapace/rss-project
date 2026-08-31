-- ============================================================================
-- Supabase Schema for Digital Edition RSS Platform
-- Issues, Articles, Article Images, and Issue Status Enum
-- ============================================================================

-- 1. Create issue_status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'issue_status') THEN
    CREATE TYPE issue_status AS ENUM ('queued', 'processing', 'review', 'published', 'failed');
  END IF;
END $$;

-- 2. Create issues table
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,                    -- 'mw' | 'ws' | 'ca' | 'wa'
  issue_id TEXT NOT NULL,                 -- '2026-09'
  issue_label TEXT NOT NULL,              -- 'September 2026'
  pdf_key TEXT NOT NULL,                  -- S3 key in pdfs/inbox/
  toc_pages INT[] DEFAULT '{3,4}',
  status issue_status DEFAULT 'queued',
  stats JSONB,                            -- Extraction / segmentation stats from worker
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (brand, issue_id)
);

-- 3. Create articles table
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_uuid UUID REFERENCES issues(id) ON DELETE CASCADE,
  sort_order INT NOT NULL,
  title TEXT NOT NULL,
  section TEXT,
  pdf_pages INT[],
  html TEXT NOT NULL,
  include BOOLEAN DEFAULT true,           -- Toggle off to drop from feed
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create article_images table
CREATE TABLE IF NOT EXISTS article_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_uuid UUID REFERENCES articles(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  width INT,
  height INT,
  sort_order INT DEFAULT 0,
  include BOOLEAN DEFAULT true,           -- Toggle off to drop image
  is_lead BOOLEAN DEFAULT false
);

-- 5. Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_issues_brand_issue_id ON issues (brand, issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues (status);
CREATE INDEX IF NOT EXISTS idx_articles_issue_uuid ON articles (issue_uuid);
CREATE INDEX IF NOT EXISTS idx_articles_sort_order ON articles (issue_uuid, sort_order);
CREATE INDEX IF NOT EXISTS idx_article_images_article_uuid ON article_images (article_uuid);
CREATE INDEX IF NOT EXISTS idx_article_images_sort_order ON article_images (article_uuid, sort_order);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_images ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
-- Allow public anon read access only to published issues and their included content
DROP POLICY IF EXISTS "Public can view published issues" ON issues;
CREATE POLICY "Public can view published issues"
  ON issues FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "Public can view included articles of published issues" ON articles;
CREATE POLICY "Public can view included articles of published issues"
  ON articles FOR SELECT
  TO anon, authenticated
  USING (
    include = true AND
    EXISTS (
      SELECT 1 FROM issues
      WHERE issues.id = articles.issue_uuid
      AND issues.status = 'published'
    )
  );

DROP POLICY IF EXISTS "Public can view included images of published articles" ON article_images;
CREATE POLICY "Public can view included images of published articles"
  ON article_images FOR SELECT
  TO anon, authenticated
  USING (
    include = true AND
    EXISTS (
      SELECT 1 FROM articles
      JOIN issues ON issues.id = articles.issue_uuid
      WHERE articles.id = article_images.article_uuid
      AND articles.include = true
      AND issues.status = 'published'
    )
  );

-- Note: The service role key bypasses RLS automatically for admin mutations and worker updates.
