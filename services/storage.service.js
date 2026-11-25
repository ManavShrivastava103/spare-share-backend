
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Tigris configuration
const requiredEnv = [
  "TIGRIS_ACCESS_KEY_ID",
  "TIGRIS_SECRET_ACCESS_KEY",
  "TIGRIS_BUCKET_NAME",
];

for (const variable of requiredEnv) {
  if (!process.env[variable]) {
    throw new Error(`Missing storage environment variable: ${variable}`);
  }
}

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev",
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID,
    secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY,
  },
});

// Generate a secure download URL for an object stored in Tigris.
const generateDownloadUrl = async ({
  objectKey,
  filename,
  expiresIn = 900,
}) => {
  if (!objectKey || !filename) {
    throw new Error("Object key and filename are required.");
  }

  const command = new GetObjectCommand({
    Bucket: process.env.TIGRIS_BUCKET_NAME,
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
};

module.exports = {
  generateDownloadUrl,
};
