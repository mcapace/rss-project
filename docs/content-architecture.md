# Whisky Advocate content architecture

**Status: proposed, not applied. Reviewed October 30, 2026.** This document recommends the reader-facing organization for Whisky Advocate within the shared, publication-aware CMS. It does not change mappings, database records, public navigation, URLs, or redirects.

## 1. Preserve first; organize without losing content

Bring every captured record into the private CMS, including incomplete, test, uncategorized, structured, and conflicting records. Keep its source identity, original fields and HTML, URL claims, and provenance. Classification determines how an item is edited and presented; it must not determine whether the source survives. An unresolved item can remain in **Needs review** without being published. Deletion and retirement are later, explicit editorial decisions.

The proposal uses the preserved Morweb archive, its 41 category and 915 tag definitions, and the reconciled public navigation: 22 primary-menu links plus six utility-menu links. Those 28 links establish navigation relationships, not exhaustive channel membership. Captures remain partial evidence of the historical website; organizing recovered material does not resolve missing historical coverage.

Existing labels mix several jobs. News and Whisky Life describe reader destinations; Bourbon describes a subject; `jmccormick` identifies an author; Magazine describes provenance; Video describes a format; and Homepage Slider or `trending` describes placement. Treat these as distinct relationships while retaining every original label in source history.

## 2. Proposed primary channels

Use six durable channels. Their labels describe reader tasks and subjects; they are not claims of demonstrated search demand.

| Proposed channel | Reader promise and subordinate destinations | Existing material to organize here |
| --- | --- | --- |
| **Whisky Reviews** | Find and compare reviewed whiskies; explore buying guides, styles, and score methodology. | Ratings, editorial buying guides, and relevant Rating & Reviews stories. Preserve the distinction between scored reviews and articles about reviews. |
| **Whisky News** | Follow new releases, distilleries, industry developments, and auctions. | News, New Releases, Dispatches, and appropriate Insights or Whisky Weekend stories. |
| **Learn About Whisky** | Understand whisky, production, styles, terminology, and practical techniques. | Whisky 101, Basics, How To, Instant Expert, and Glossary. |
| **Cocktails & Food** | Make drinks and explore food pairings. | Cocktails, Cocktail, Recipe, Food, and relevant existing features. |
| **Travel & Culture** | Discover destinations, distilleries, bars, people, clubs, collecting, and useful gear. | Travel, Bars, Clubs, Gear, Collecting, and relevant Whisky Life features. |
| **Top 20 Whiskies** | Explore the annual selection, ranked entries, methodology, and previous years. | Top20 and its year/carousel categories. Preserve the separate site's current destination until its integration is decided. |

Keep **WhiskyFest** prominent as an event destination, with **The Magazine**, **Videos**, **Subscribe**, **Newsletters**, and **Store** available through utility navigation or suitable contextual links. Videos can also appear in their subject channels. Magazine issues are collections of stories, not competing permanent homes for every print-derived article. Place Top Whisky Bars within Travel & Culture while preserving access to its separate application.

**Compact alternative, also proposed:** retain **Whisky Life** as one channel containing Cocktails & Food and Travel & Culture, producing five primary editorial channels. Choose between these options after navigation testing and reviewing audience demand. Existing brand recognition may justify retaining Whisky Life; a split may make important subjects easier to find.

Channel pages should combine a concise editorial introduction, useful subtopics, selected evergreen material, recent coverage, and accessible archive navigation. Avoid creating a channel for every legacy category. Insights, Dispatches, Instant Expert, and Whisky Weekend can remain recognizable series within appropriate channels.

## 3. Separate the content model from navigation

Each item belongs to one publication. A publishable editorial item should normally have one permanent primary channel and appropriate secondary topics, entities, series, and collections. It can appear on several pages without becoming several articles.

| Content type or relationship | Proposed treatment |
| --- | --- |
| **Story** | News, features, interviews, opinion, guides, and sponsored stories share core editorial fields, with an explicit format and commercial disclosure. |
| **Whisky review** | Preserve the reviewed expression, reviewer, score, price text, tasting notes, issue, and original dates. A product can have multiple distinct reviews over time. |
| **Top 20 entry** | Keep year, rank, product relationship, narrative, score, and original URL. Year collections order entries; they are not ordinary tag lists. |
| **Glossary term** | Preserve the term and definition, add reviewed synonyms, and link to explanatory guides. |
| **Club listing** | Preserve location, contact details, meetings, membership information, and descriptive fields. An empty generic article body does not invalidate a populated directory entry. |
| **Other spirits or product entry** | Preserve TopShelf content without inventing a whisky score or forcing it into the whisky-review model. |
| **Page** | Assemble landing pages, information pages, and directories from captured components where available. Metadata alone is not a completed page. |
| **Unclassified source item** | Retain it privately with an identifiable review task. Do not guess a type, fabricate a body, or discard it. |

Topics describe what a story covers: Bourbon, Scotch, Irish Whiskey, Rye, Collecting, or Food Pairings. Entities identify particular authors, brands, distilleries, producers, bottlings, and places. Keep their roles explicit: a producer is not necessarily the brand or distillery named on a bottle.

Use stable entity identities with reviewed display names and aliases. Consider Cocktail/Cocktails as a consolidation candidate, but do not automatically merge every similar label. Preserve original tag identifiers and spellings in the migration crosswalk. Author tags should become author relationships only when evidence supports the association; a legacy CMS account is not an editorial byline.

Create public topic or entity hubs selectively when they offer useful explanations and meaningful coverage. Do not automatically publish 915 thin tag pages or every combination of filters. Review new hub names, duplicate concepts, and search-index treatment together. Sponsored status remains a visible disclosure and editorial attribute, not a substitute for a subject channel.

The shared CMS can reuse these capabilities across publications while each publication controls its own navigation, vocabulary, domains, and permissions. Changing the publication selector must not copy content or expose another publication's drafts. Cross-publication reuse needs an intentional content and canonical-URL decision.

## 4. Homepage promotion is temporary; an article's home is durable

Replace Homepage Slider, Homepage News Slider, and `trending` category behavior with explicit **placements**. Reader-facing controls should use ordinary labels such as **Homepage lead**, **Homepage feature**, **Channel lead**, and **Trending**.

An assignment records the item, destination slot, ordering, start, optional end, and responsible editor. Display times in the publication's agreed timezone. An open-ended placement must be an explicit choice. Retain uncertain historical schedule values as source evidence rather than replaying them automatically.

Promotion requires an eligible public item and must respect embargoes and visibility. Warn editors about conflicting lead slots or an end before a start. A placement can override its promotional image or short headline without overwriting the article's title, URL, or original image.

**On expiry, remove the placement only.** The article remains available at its existing URL, in its permanent channel archive, relevant topic pages, and site search. Its eligible sitemap entry and editorial status do not expire. For example, a new-release story can leave the homepage on Monday while remaining a Whisky News story indefinitely. Expiring a promotion must never orphan or unpublish it.

## 5. Routing: improve hierarchy without moving existing articles

Retain captured public URLs until an explicit route decision is approved. Changing a channel or tag does not require changing a story's address. The observed routes include `/ratings-reviews`, `/News`, `/Whisky-101`, `/whiskey-life`, `/Glossary`, and mixed-case tag paths; do not silently lowercase, rename, or re-parent them.

| Routing situation | Proposed handling |
| --- | --- |
| Existing article changes channel | Keep its URL; update navigation, relevant links, and breadcrumbs. |
| Existing hub receives a clearer label | Change its visible label and useful content independently of its path. |
| A new hub has no existing counterpart | Reserve a reviewed path in that publication; proposed labels above do not authorize new routes. |
| Two reviews claim one legacy URL | Retain both source records. Decide the URL owner and an address for the other review explicitly; do not silently overwrite or suffix either. |
| A route is intentionally replaced | Maintain an old-to-new mapping, use a direct permanent redirect, and update links, canonical annotations, and sitemaps. |
| WhiskyFest, Top 20, or Bars remains external | Preserve its working destination. A menu link is not proof its application or complete content has been migrated. |

Use breadcrumbs to describe a sensible reader path, such as Home → Learn About Whisky → How To → Story, even when the article has a flat legacy URL. Google explicitly recommends a typical user path rather than simply reproducing URL segments.[1]

Every intended public article should have a crawlable link from a channel archive or another appropriate page, with meaningful link text. Provide ordinary links and navigable archive pages, not discovery that depends solely on search boxes or infinite scroll. Google's link guidance supports crawlable anchors and contextual internal linking.[2]

Separate route ownership by publication/domain; the shared CMS does not require putting `/wa/` into Whisky Advocate's existing URLs. If URL changes become necessary, test the full mapping and avoid unrelated homepage redirects. Google recommends mapping old URLs, permanent redirects, updated annotations, and monitoring; a CMS redesign is not a reason to introduce additional URL changes.[3]

## 6. SEO and generative answer discovery

Treat GEO as helping readers and retrieval systems find accurate, attributable information. It is not a separate set of guaranteed ranking tricks. Google's AI Overviews/AI Mode guidance says existing SEO fundamentals apply, supporting pages must be indexed and eligible for snippets, and no special AI files or schema are required. Eligibility does not guarantee indexing, inclusion, or rankings. This guidance concerns Google; it does not establish identical behavior for every AI service.[4]

**Editorial recommendation:** make important facts understandable in visible page text. Use descriptive titles and headings, clear explanations, named authors, sources where appropriate, and distinguish reporting, tasting judgment, sponsorship, and factual specifications. For reviews, present expression, ABV, score, reviewer, issue, and price context together. Define specialized terms and link relevant entities. These improve usability and attribution; no citation uplift is promised.

Preserve original publication evidence and distinguish a meaningful update from a migration timestamp. Do not invent missing dates, timezones, scores, authors, or ratings. Give authors useful profile pages and publish the review methodology. Keep summaries faithful to the actual article rather than producing repetitive question-and-answer filler.

At public-template implementation, use applicable Article/NewsArticle properties for real stories and BreadcrumbList for actual navigation. Supply accurate author, representative image, headline, and date information where known. Google documents these Article properties but does not require all of them.[5] Choose additional markup only after reviewing the relevant feature rules; do not promise review stars or FAQ results across the site.

Structured data must describe visible content. JSON-LD can express the same facts, but hidden assertions or empty schema-only pages are inappropriate under Google's guidance.[6] Validate eligible templates with the Rich Results Test and inspect actual rendered pages. Preserve image captions, credits, and meaningful alternative text as part of the editorial model.

## 7. Validation and rollout

1. **Complete private preservation.** Reconcile every captured identity and its status; retain unresolved records and original URL claims. Keep historical completeness work separate from imported counts.
2. **Test the proposed organization.** Have editors classify representative stories, reviews, terms, clubs, sponsored entries, and Top 20 items. Test common reader tasks against both navigation options.
3. **Validate demand.** Review Search Console queries and landing pages, site-search terms, analytics, subscriptions, and editorial priorities before choosing final labels or creating additional hubs. This proposal includes no keyword-volume or conversion research.
4. **Build representative private previews.** Verify one channel, topic page, article, review, directory, and annual collection. Test a promotion's expiry while confirming the article remains discoverable at the same address.
5. **Prepare public launch separately.** Reconcile routes, media, external properties, access rules, canonicals, sitemaps, and redirects. Track discovery, indexing, traffic, and reader outcomes after release. Google's AI-feature traffic is included in Search Console's Web reporting; that does not provide a complete citation count across AI products.[4]

## Official sources and limits

Retrieved directly from Google Search Central on October 30, 2026 after the search tool returned an error. These sources support implementation principles, not the proposed channel names or predictions of traffic gains.

1. [Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) — hierarchy and typical reader paths need not mirror URL segments.
2. [Link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) — crawlable anchors, descriptive link text, and internal discovery.
3. [Site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes) — URL mapping, redirects, annotations, and migration monitoring; applicable when URLs actually change.
4. [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) — Google-specific eligibility, ordinary SEO practices, reporting, and lack of guarantees.
5. [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article) — relevant article properties; markup is not an inclusion guarantee.
6. [Introduction to structured data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) — markup describes visible page content; feature-specific rules still apply.
