import "server-only";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function getS3Client(): S3Client {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY credentials."
    );
  }

  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export async function createPresignedUploadUrl({
  key,
  contentType = "application/pdf",
  expiresInSeconds = 1800, // 30 minutes
}: {
  key: string;
  contentType?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const s3 = getS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Print storage has not been connected yet.");

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    IfNoneMatch: "*",
  });

  return await getSignedUrl(s3, command, {
    expiresIn: expiresInSeconds,
  });
}

/** Confirm the uploaded object is a bounded PDF before reserving a processing job. */
export async function verifyPdfUpload(key: string) {
  const { CmsError } = await import("./cms/access");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new CmsError(503, "Print storage has not been connected yet.", "setup_required");
  const client = getS3Client();
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (!head.ContentLength || head.ContentLength > 500 * 1024 * 1024) throw new CmsError(422, "Choose a nonempty PDF no larger than 500 MB.");
    const signature = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-4", IfMatch: head.ETag }));
    const bytes = await signature.Body?.transformToString();
    if (bytes !== "%PDF-") throw new CmsError(422, "The uploaded file is not a PDF.");
  } catch (error) {
    if (error instanceof CmsError) throw error;
    throw new CmsError(422, "The uploaded PDF could not be verified. Please upload it again.");
  }
}
