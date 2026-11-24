
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const requiredEnv = [
  "B2_REGION",
  "B2_ENDPOINT",
  "B2_ACCESS_KEY_ID",
  "B2_SECRET_ACCESS_KEY",
  "B2_BUCKET_NAME",
];

for (const variable of requiredEnv) {
  if (!process.env[variable]) {
    throw new Error(`Missing storage environment variable: ${variable}`);
  }
}

const s3Client = new S3Client({
  region: process.env.B2_REGION,
  endpoint: process.env.B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
  },
});

const generateDownloadUrl = async ({
  objectKey,
  filename,
  expiresIn = 900,
}) => {
  if (!objectKey || !filename) {
    throw new Error("Object key and filename are required.");
  }

  const command = new GetObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
};

module.exports = {
  generateDownloadUrl,
};
