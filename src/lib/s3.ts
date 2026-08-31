import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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
  const bucket = process.env.S3_BUCKET || "mshanken-digital-editions";

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(s3, command, {
    expiresIn: expiresInSeconds,
  });
}
