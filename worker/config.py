"""
Per-brand configuration. Add a block per publication.
The pipeline is driven entirely by this file; no brand logic lives in the code.
"""

BRANDS = {
    "mw": {
        "name": "Market Watch",
        "slug": "marketwatch",
        "feed_title_template": "MW {issue_label}",          # e.g. "MW September 2026"
        "site_link": "https://www.marketwatchmag.com",
        "language": "en",
        # S3 / CDN
        "s3_bucket": "mshanken-digital-editions",            # <- your bucket
        "s3_prefix": "marketwatch",                          # keys: marketwatch/{issue}/pNNN_xXXXX.jpg
        "cdn_base": "https://editions.marketwatchmag.com",   # CloudFront in front of the bucket
        # Image filtering
        "min_image_px": 300,        # skip fragments/rules/icons smaller than this on both axes
        "min_image_bytes": 20_000,  # skip tiny decorative crops
        # Pages to always exclude (covers handled separately, ad pages added per issue)
        "exclude_pages": [],
    },
    "ws": {
        "name": "Wine Spectator",
        "slug": "winespectator",
        "feed_title_template": "WS {issue_label}",
        "site_link": "https://www.winespectator.com",
        "language": "en",
        "s3_bucket": "mshanken-digital-editions",
        "s3_prefix": "winespectator",
        "cdn_base": "https://editions.winespectator.com",
        "min_image_px": 300,
        "min_image_bytes": 20_000,
        "exclude_pages": [],
    },
    "ca": {
        "name": "Cigar Aficionado",
        "slug": "cigaraficionado",
        "feed_title_template": "CA {issue_label}",
        "site_link": "https://www.cigaraficionado.com",
        "language": "en",
        "s3_bucket": "mshanken-digital-editions",
        "s3_prefix": "cigaraficionado",
        "cdn_base": "https://editions.cigaraficionado.com",
        "min_image_px": 300,
        "min_image_bytes": 20_000,
        "exclude_pages": [],
    },
}
