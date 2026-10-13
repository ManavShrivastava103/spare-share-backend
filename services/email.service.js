
const nodemailer = require("nodemailer");

const MAIL_CONFIG = (process.env.MAIL_CONFIG || "smtp").trim().toLowerCase();
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);

if (!["smtp", "apps-script"].includes(MAIL_CONFIG)) {
  throw new Error('Invalid MAIL_CONFIG. Use "smtp" or "apps-script".');
}

let transporter;

if (MAIL_CONFIG === "smtp") {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function getEmailContent(purpose) {
  switch (purpose) {
    case "email-verification":
      return {
        title: "Verify your email",
        description: "Use the verification code below to verify your email address."
      };
    case "login":
      return {
        title: "Your login code",
        description: "Use the code below to securely sign in to your account."
      };
    case "forgot-password":
      return {
        title: "Reset your password",
        description: "Use the code below to continue resetting your password."
      };
    default:
      return {
        title: "Your verification code",
        description: "Use the code below to continue."
      };
  }
}

function buildEmail({ otp, userName, purpose }) {
  const { title, description } = getEmailContent(purpose);
  const safeName = escapeHtml(userName || "there");
  const safeOtp = escapeHtml(otp);
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const minutes = Math.max(1, Math.min(OTP_EXPIRY_MINUTES, 60));

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <div style="width:100%;padding:32px 16px;box-sizing:border-box;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e9e9;border-radius:14px;overflow:hidden;">
      <div style="padding:24px 30px;background:#0A6E68;color:#fff;font-size:20px;font-weight:700;">
        SpareShare Hosting Services
      </div>
      <div style="padding:32px 30px;">
        <div style="font-size:23px;font-weight:700;color:#172121;margin-bottom:12px;">${safeTitle}</div>
        <div style="font-size:15px;line-height:1.65;color:#667272;">
          Hi ${safeName},<br><br>${safeDescription}
        </div>
        <div style="background:#f3f8f7;border:1px solid #dceae8;border-radius:12px;padding:20px;text-align:center;margin:22px 0;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.8px;color:#718080;margin-bottom:9px;">Verification Code</div>
          <div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#0A6E68;">${safeOtp}</div>
        </div>
        <div style="font-size:13px;line-height:1.6;color:#7b8585;">
          This code will expire in <strong>${minutes} minutes</strong>.<br>
          If you did not request this code, you can safely ignore this email.
        </div>
      </div>
      <div style="padding:18px 30px;border-top:1px solid #edf0f0;color:#899292;font-size:12px;">
        This is an automated message. Please do not reply to this email.
      </div>
    </div>
  </div>
</body>
</html>`;

  const text = `${title}\n\nHi ${userName || "there"},\n\n${description}\n\nYour verification code is: ${otp}\n\nThis code expires in ${minutes} minutes.`;

  return { title, html, text };
}

async function sendViaSmtp({ email, otp, purpose, userName }) {
  const { title, html, text } = buildEmail({ otp, purpose, userName });

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error("SMTP configuration is incomplete. Check SMTP_HOST, SMTP_USER, and SMTP_PASSWORD.");
  }

  return transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: title,
    text,
    html
  });
}

async function sendViaAppsScript({ email, otp, purpose, userName }) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;

  if (!url || !url.endsWith("/exec") || !secret) {
    throw new Error("Apps Script configuration is incomplete. Check APPS_SCRIPT_URL and APPS_SCRIPT_SECRET.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      email,
      otp: String(otp),
      purpose,
      userName: userName || "there",
      expiryMinutes: OTP_EXPIRY_MINUTES
    }),
    signal: AbortSignal.timeout(20000)
  });

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`Apps Script returned an unexpected response (HTTP ${response.status}). Check the deployed Web app URL and access settings.`);
  }

  if (!response.ok || result.success !== true) {
    throw new Error(result.error || `Apps Script email request failed (HTTP ${response.status}).`);
  }

  return result;
}

async function sendOtpEmail({ email, otp, purpose, userName }) {
  if (!email || !otp) {
    throw new Error("Email and OTP are required to send an OTP email.");
  }

  if (MAIL_CONFIG === "apps-script") {
    return sendViaAppsScript({ email, otp, purpose, userName });
  }

  return sendViaSmtp({ email, otp, purpose, userName });
}

module.exports = { sendOtpEmail };
