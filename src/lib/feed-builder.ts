/**
 * XML string escaping helper
 */
export function escapeXml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface FeedArticleImage {
  id?: string;
  s3_key: string;
  width: number | null;
  height: number | null;
  sort_order?: number;
  include?: boolean;
  is_lead?: boolean;
}

export interface FeedArticle {
  id: string;
  sort_order: number;
  title: string;
  section: string | null;
  pdf_pages: number[] | null;
  html: string;
  include: boolean;
  created_at: string;
  images?: FeedArticleImage[];
}

export interface FeedIssue {
  id: string;
  brand: string;
  issue_id: string;
  issue_label: string;
  pdf_key: string;
  created_at: string;
  articles: FeedArticle[];
}

/**
 * Derives CDN or S3 base URL for the brand
 */
export function getBaseImageUrl(brand: string): string {
  const normBrand = brand.toLowerCase();
  const cdnEnvKey = `CDN_BASE_${normBrand.toUpperCase()}`;
  const customCdn = process.env[cdnEnvKey];
  if (customCdn && customCdn.trim()) {
    return customCdn.replace(/\/+$/, "");
  }

  const s3Bucket = process.env.S3_BUCKET || "mshanken-digital-editions";
  return `https://${s3Bucket}.s3.amazonaws.com`;
}

/**
 * Builds RSS 2.0 XML strictly following the BlueToad contract.
 */
export function generateRssFeed(issue: FeedIssue, originUrl: string): string {
  const brandBase = getBaseImageUrl(issue.brand);
  const feedUrl = `${originUrl}/api/feeds/${issue.brand}/${issue.issue_id}/feed.xml`;
  const pubDate = new Date(issue.created_at).toUTCString();

  const brandNames: Record<string, string> = {
    mw: "Market Watch",
    ws: "Wine Spectator",
    ca: "Cigar Aficionado",
    wa: "Whisky Advocate",
  };
  const channelTitle = `${brandNames[issue.brand.toLowerCase()] || issue.brand.toUpperCase()} — ${issue.issue_label}`;

  const itemsXml = (issue.articles || [])
    .filter((article) => article.include !== false)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((article, index) => {
      const articleNumber = String(index + 1).padStart(3, "0");
      const articleGuid = `${brandBase}/${issue.issue_id}/article-${articleNumber}`;
      const articleLink = `${brandBase}/${issue.issue_id}/article-${articleNumber}`;
      const itemPubDate = article.created_at
        ? new Date(article.created_at).toUTCString()
        : pubDate;

      // Filter and sort included images
      const includedImages = (article.images || [])
        .filter((img) => img.include !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      // Identify lead image (first is_lead or first image)
      const leadImage =
        includedImages.find((img) => img.is_lead) || includedImages[0];

      // Build description HTML: lead <img> tag inline followed by article HTML
      let descriptionHtml = "";
      if (leadImage) {
        const leadImgUrl = `${brandBase}/${leadImage.s3_key}`;
        descriptionHtml += `<img src="${leadImgUrl}" />`;
      }
      if (article.html) {
        descriptionHtml += article.html;
      }

      // Build media:content XML elements for all images
      const mediaContentXml = includedImages
        .map((img) => {
          const imgUrl = `${brandBase}/${img.s3_key}`;
          const mimeType = img.s3_key.endsWith(".png")
            ? "image/png"
            : img.s3_key.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";
          const widthAttr = img.width ? ` width="${img.width}"` : "";
          const heightAttr = img.height ? ` height="${img.height}"` : "";
          return `    <media:content url="${escapeXml(
            imgUrl
          )}" type="${mimeType}"${widthAttr}${heightAttr} medium="image" />`;
        })
        .join("\n");

      return `  <item>
    <title>${escapeXml(article.title)}</title>
    <link>${escapeXml(articleLink)}</link>
    <guid isPermaLink="false">${escapeXml(articleGuid)}</guid>
    <dc:creator>${escapeXml(article.section || "")}</dc:creator>
    <pubDate>${itemPubDate}</pubDate>
    <description>${escapeXml(descriptionHtml)}</description>
${mediaContentXml ? mediaContentXml + "\n" : ""}  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"
  xmlns:slash="http://purl.org/rss/1.0/modules/slash/"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <atom:link href="${escapeXml(
      feedUrl
    )}" rel="self" type="application/rss+xml" />
    <link>${escapeXml(originUrl)}</link>
    <description>${escapeXml(
      `Digital edition feed for ${issue.issue_label}`
    )}</description>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <language>en-US</language>
${itemsXml}
  </channel>
</rss>`;
}
