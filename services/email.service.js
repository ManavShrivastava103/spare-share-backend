const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

const sendOtpEmail = async ({
  email,
  otp,
  purpose,
  userName,
}) => {
  let title;
  let description;

  switch (purpose) {
    case "email-verification":
      title = "Verify your email";
      description =
        "Use the verification code below to verify your email address.";
      break;

    case "login":
      title = "Your login code";
      description =
        "Use the code below to securely sign in to your account.";
      break;

    case "forgot-password":
      title = "Reset your password";
      description =
        "Use the code below to continue resetting your password.";
      break;

    default:
      title = "Your verification code";
      description =
        "Use the code below to continue.";
  }

  const expiryMinutes =
    Number(process.env.OTP_EXPIRY_MINUTES) || 10;

  const safeName = userName || "there";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
  <title>${title}</title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background:#f4f7f7;
    font-family:Arial,Helvetica,sans-serif;
    color:#1f2933;
  "
>

  <div
    style="
      width:100%;
      padding:32px 16px;
      box-sizing:border-box;
    "
  >

    <div
      style="
        max-width:560px;
        margin:0 auto;
        background:#ffffff;
        border:1px solid #e4e9e9;
        border-radius:14px;
        overflow:hidden;
      "
    >

      <!-- Header -->

      <div
        style="
          padding:24px 30px;
          background:#0A6E68;
        "
      >

        <div
          style="
            color:#ffffff;
            font-size:20px;
            font-weight:700;
            letter-spacing:-0.2px;
          "
        >
          SpareShare Hosting Services
        </div>

      </div>

      <!-- Content -->

      <div style="padding:32px 30px;">

        <div
          style="
            font-size:23px;
            font-weight:700;
            color:#172121;
            margin-bottom:12px;
          "
        >
          ${title}
        </div>

        <div
          style="
            font-size:15px;
            line-height:1.65;
            color:#667272;
            margin-bottom:22px;
          "
        >
          Hi ${safeName},
          <br /><br />

          ${description}
        </div>

        <!-- OTP -->

        <div
          style="
            background:#f3f8f7;
            border:1px solid #dceae8;
            border-radius:12px;
            padding:20px;
            text-align:center;
            margin:22px 0;
          "
        >

          <div
            style="
              font-size:11px;
              text-transform:uppercase;
              letter-spacing:1.8px;
              color:#718080;
              margin-bottom:9px;
            "
          >
            Verification Code
          </div>

          <div
            style="
              font-size:28px;
              font-weight:700;
              letter-spacing:6px;
              color:#0A6E68;
            "
          >
            ${otp}
          </div>

        </div>

        <div
          style="
            font-size:13px;
            line-height:1.6;
            color:#7b8585;
          "
        >
          This code will expire in
          <strong>${expiryMinutes} minutes</strong>.
          <br />

          If you did not request this code, you can safely ignore
          this email.
        </div>

      </div>

      <!-- Footer -->

      <div
        style="
          padding:18px 30px;
          border-top:1px solid #edf0f0;
          color:#899292;
          font-size:12px;
          line-height:1.6;
        "
      >
        This is an automated message. Please do not reply to
        this email.
      </div>

    </div>

  </div>

</body>
</html>
`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: title,
    html,
  });
};

module.exports = {
  sendOtpEmail,
};
