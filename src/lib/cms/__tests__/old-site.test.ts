import { describe, expect, it } from "vitest";
import { cleanBody, isoDate, listingLinks, parseFeed, parsePost, parseSitemap, sitePath } from "../old-site";

const story = `<script>mwData.BlogsPostID = 17907;</script>
<meta name="description" content="We review Heaven Hill Phoenix, a $325 bourbon.">
<meta name="keywords" content="News,New Releases,Bourbon,sevans">
<h1 class="postDetailsTitle">Heaven Hill Phoenix Puts 30 Year Old Pre-Fire Bourbon in Your Glass</h1>
<p class="postDetailsSubheader">The $325 release marks the fire&rsquo;s 30th anniversary</p>
<p class="postsDetailsDate">November 10, 2026 –––––– <a href="/tag/sevans">Sean Evans</a></p>
<img class="postDetailsBannerImg" src="/get/files/image/galleries/HH_Phoenix-HERO.jpg?resize=1920x0" alt="">
<div class="postDetailsBannerCaption"><p>The Phoenix carton (Photo by Heaven Hill)</p></div>
<div class="postDetailsContent"><div class="inner"><p class="x">First paragraph.</p><p><img data-crop-sn="1" src="/get/files/image/galleries/a.jpg?resize=800x0"></p><p>&nbsp;</p></div></div>
<span><a href="/tag/new-releases">New Releases</a></span><span><a href="/tag/bourbon">Bourbon</a></span><span><a href="/tag/sevans">sevans</a></span>`;

const rating = `<script>mwData.BlogsPostID = 17885;</script>
<meta name="description" content="Initially matured in bourbon barrels.">
<div class="postDetailsRanking"><h3>90</h3><p>Score</p></div>
<div class="postDetailsTitle"><h1>Jura 12 year old, 40%</h1></div>
<div class="postDetailsStats"><p>Price: <span class="ratingsPrice">45</span> <span>●</span> Issue: Fall 2026 <span>●</span> Reviewer: Julia Higgins <span>●</span> Category: Single Malt Scotch</p></div>
<div class="postDetailsContent"><p>Initially matured in bourbon barrels.</p></div>`;

describe("old site reader", () => {
  it("reads a story page", () => {
    const post = parsePost("/heaven-hill-phoenix-bourbon-review", story)!;
    expect(post).toMatchObject({
      postId: "17907", kind: "article", date: "2026-11-10", authors: ["Sean Evans"],
      dek: "The $325 release marks the fire’s 30th anniversary",
      hero: "https://whiskyadvocate.com/get/files/image/galleries/HH_Phoenix-HERO.jpg",
      heroCaption: "The Phoenix carton (Photo by Heaven Hill)",
      tags: ["New Releases", "Bourbon", "sevans"], keywords: ["News", "New Releases", "Bourbon", "sevans"],
    });
    expect(post.body).toBe('<div><p>First paragraph.</p><p><img src="https://whiskyadvocate.com/get/files/image/galleries/a.jpg"></p></div>');
  });

  it("reads a rating page", () => {
    expect(parsePost("/Jura-12-year-old-40-2026-review", rating)).toMatchObject({
      kind: "rating", title: "Jura 12 year old, 40%",
      rating: { score: 90, price: 45, priceRaw: "45", issue: "Fall 2026", reviewer: "Julia Higgins", category: "Single Malt Scotch" },
    });
  });

  it("needs a post id", () => expect(parsePost("/about", "<h1>About</h1>")).toBeNull());

  it("reads the feed, listings and dates", () => {
    expect(parseFeed("<item><title><![CDATA[The End of the Road for Hedonism]]></title><link>https://whiskyadvocate.com/compass-box-discontinues-hedonism</link><pubDate>Thu, 12 Nov 2026 15:09:29 GMT</pubDate></item>"))
      .toEqual([{ path: "/compass-box-discontinues-hedonism", title: "The End of the Road for Hedonism", published: "2026-11-12T15:09:29.000Z" }]);
    expect(listingLinks('<a href="/diageo-special-releases-ends">x</a><a href="/News">y</a><a href="https://example.com/some-long-path-here">z</a><a href="/files/site.css">c</a>')).toEqual(["/diageo-special-releases-ends"]);
    expect(sitePath("https://www.whiskyadvocate.com/News/")).toBe("/News");
    expect(parseSitemap("<loc>https://whiskyadvocate.com/Penelope-Toasted-Barrel-Strength-56-1&#13;</loc><loc>https://whiskyadvocate.com/a&amp;b</loc>")).toEqual(["/Penelope-Toasted-Barrel-Strength-56-1", "/a&b"]);
    expect(isoDate("March 3, 2026")).toBe("2026-03-03");
    expect(cleanBody('<a href="/tag/x">x</a><!-- c -->')).toBe('<a href="https://whiskyadvocate.com/tag/x">x</a>');
  });
});
