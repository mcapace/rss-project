"""
Worker stage 3 - publish_db.py
Uploads extracted images to S3 and writes articles + image records to
Supabase, then flips the issue to 'review'. The feed itself is rendered
live by the Next.js /api/feeds route from these tables.

Env: AWS creds, S3_BUCKET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
Usage: python publish_db.py <brand> <issue_id> --issue-uuid <uuid>
"""
import os, sys, json, argparse, mimetypes
import boto3
from supabase import create_client


def run(brand, issue_id, issue_uuid, out_root="output"):
    out_dir = os.path.join(out_root, brand, issue_id)
    data = json.load(open(os.path.join(out_dir, "articles.json")))
    manifest = json.load(open(os.path.join(out_dir, "pages.json")))

    s3 = boto3.client("s3")
    bucket = os.environ["S3_BUCKET"]
    prefix = f"{brand}/{issue_id}/images"
    sb = create_client(os.environ["SUPABASE_URL"],
                       os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # upload every kept image once
    img_dir = os.path.join(out_dir, "images")
    uploaded = set()
    for fname in sorted(os.listdir(img_dir)):
        s3.upload_file(os.path.join(img_dir, fname), bucket, f"{prefix}/{fname}",
                       ExtraArgs={"ContentType": mimetypes.guess_type(fname)[0] or "image/jpeg",
                                  "CacheControl": "public, max-age=31536000"})
        uploaded.add(fname)

    # replace any prior rows for this issue (idempotent re-runs)
    sb.table("articles").delete().eq("issue_uuid", issue_uuid).execute()

    for order, art in enumerate(data["articles"]):
        row = sb.table("articles").insert({
            "issue_uuid": issue_uuid, "sort_order": order,
            "title": art["title"], "section": art.get("section", ""),
            "pdf_pages": art["pdf_pages"], "html": art["html"],
        }).execute().data[0]
        img_rows = []
        for j, img in enumerate(art["images"]):
            if img["file"] not in uploaded:
                continue
            img_rows.append({
                "article_uuid": row["id"], "s3_key": f"{prefix}/{img['file']}",
                "width": img["w"], "height": img["h"],
                "sort_order": j, "is_lead": j == 0,
            })
        if img_rows:
            sb.table("article_images").insert(img_rows).execute()

    sb.table("issues").update({
        "status": "published",
        "stats": manifest["stats"],
        "error": None,
    }).eq("id", issue_uuid).execute()
    print(f"published {len(data['articles'])} articles, {len(uploaded)} images -> published")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("brand"); ap.add_argument("issue")
    ap.add_argument("--issue-uuid", required=True)
    a = ap.parse_args()
    run(a.brand, a.issue, a.issue_uuid)
