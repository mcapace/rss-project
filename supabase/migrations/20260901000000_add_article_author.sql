-- Add author byline column for BlueToad-compatible dc:creator mapping
ALTER TABLE articles ADD COLUMN IF NOT EXISTS author TEXT;
