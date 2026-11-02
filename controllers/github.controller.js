
const crypto = require("crypto");

const GitHubOAuthState = require("../models/githubOAuthState.model");
const GitHubInstallation = require("../models/githubInstallation.model");

const {
  getInstallationDetails,
} = require("../services/github.service");

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

// Generate a secure GitHub App installation URL.
const startGitHubInstallation = async (req, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw createError(
        "Authentication required.",
        401,
        "AUTHENTICATION_REQUIRED"
      );
    }

    const appSlug = process.env.GITHUB_APP_SLUG;

    if (!appSlug) {
      throw createError(
        "GitHub App configuration is missing.",
        500,
        "GITHUB_CONFIG_MISSING"
      );
    }

    // Generate a cryptographically secure, one-time state.
    const state = GitHubOAuthState.generateState();

    const stateHash = crypto
      .createHash("sha256")
      .update(state)
      .digest("hex");

    // Expire state after 10 minutes.
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await GitHubOAuthState.create({
      stateHash,
      userId,
      expiresAt,
    });

    const installationUrl = new URL(
      `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`
    );

    installationUrl.searchParams.set("state", state);

    return res.status(200).json({
      success: true,
      message: "GitHub installation URL generated.",
      installationUrl: installationUrl.toString(),
      expiresInSeconds: 600,
    });
  } catch (error) {
    next(error);
  }
};


// Complete GitHub installation and return the user to SpareShare.
const completeGitHubInstallation = async (req, res, next) => {
  try {
    const {
      installation_id,
      setup_action,
      state,
    } = req.query;

    if (
      typeof installation_id !== "string" ||
      !/^\d+$/.test(installation_id) ||
      !["install", "update"].includes(setup_action) ||
      typeof state !== "string" ||
      !/^[a-f0-9]{64}$/.test(state)
    ) {
      throw createError(
        "Invalid GitHub installation callback.",
        400,
        "INVALID_GITHUB_CALLBACK"
      );
    }

    const deepLink =
      process.env.GITHUB_MOBILE_DEEP_LINK ||
      "spareshare://github/connected";

    // Only permit the registered SpareShare deep link.
    if (deepLink !== "spareshare://github/connected") {
      throw createError(
        "Invalid mobile application redirect configuration.",
        500,
        "INVALID_MOBILE_REDIRECT_CONFIG"
      );
    }

    const stateHash = crypto
      .createHash("sha256")
      .update(state)
      .digest("hex");

    // Atomically consume the state once, if it has not expired.
    const savedState = await GitHubOAuthState.findOneAndDelete({
      stateHash,
      expiresAt: { $gt: new Date() },
    });

    if (!savedState) {
      throw createError(
        "GitHub connection state is invalid, expired, or already used. Please try again.",
        400,
        "INVALID_OR_EXPIRED_GITHUB_STATE"
      );
    }

    const installationId = Number(installation_id);

    // Verify the installation using GitHub App credentials.
    const details = await getInstallationDetails(installationId);

    if (
      !details.accountId ||
      !details.accountLogin ||
      !details.accountType ||
      !details.repositorySelection
    ) {
      throw createError(
        "GitHub returned incomplete installation details.",
        502,
        "INVALID_GITHUB_INSTALLATION_DETAILS"
      );
    }

    // Check whether this installation is already linked.
    const existingInstallation =
      await GitHubInstallation.findOne({ installationId });

    // Never allow an installation to be reassigned.
    if (
      existingInstallation &&
      String(existingInstallation.userId) !==
        String(savedState.userId)
    ) {
      throw createError(
        "This GitHub installation is already connected to another SpareShare account.",
        409,
        "GITHUB_INSTALLATION_ALREADY_LINKED"
      );
    }

    const installationData = {
      userId: savedState.userId,
      accountId: details.accountId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      repositorySelection: details.repositorySelection,
      permissions: details.permissions,
      status: details.suspendedAt ? "suspended" : "active",
      lastSyncedAt: new Date(),
    };

    await GitHubInstallation.findOneAndUpdate(
      { installationId },
      {
        $set: installationData,
        $setOnInsert: {
          installationId,
          installedAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    // Prevent caching of the callback response.
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });

    // HTML success page with a manual fallback button.
    return res.status(200).type("html").send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />

          <meta
            name="robots"
            content="noindex, nofollow"
          />

          <title>GitHub Connected | SpareShare</title>

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
              background: #f5f7fb;
              font-family: Arial, sans-serif;
              color: #172033;
            }

            .container {
              width: 100%;
              max-width: 420px;
              padding: 36px 26px;
              background: white;
              border-radius: 18px;
              text-align: center;
              box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
            }

            .success {
              width: 64px;
              height: 64px;
              margin: 0 auto 20px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 50%;
              background: #dcfce7;
              color: #15803d;
              font-size: 34px;
            }

            h1 {
              font-size: 25px;
              margin-bottom: 12px;
            }

            p {
              color: #64748b;
              line-height: 1.6;
              font-size: 15px;
            }

            .button {
              display: block;
              margin-top: 25px;
              padding: 15px;
              border-radius: 10px;
              background: #172554;
              color: white;
              text-decoration: none;
              font-weight: bold;
            }

            .note {
              font-size: 12px;
              margin-top: 18px;
            }
          </style>
        </head>

        <body>
          <div class="container">

            <div class="success">&#10003;</div>

            <h1>GitHub Connected!</h1>

            <p>
              Your GitHub account has been successfully
              connected to SpareShare.
            </p>

            <p>
              Return to SpareShare to continue selecting
              your repository and deploying your project.
            </p>

            <a
              class="button"
              href="spareshare://github/connected"
            >
              Open SpareShare
            </a>

            <p class="note">
              If the app does not open automatically,
              tap the button above.
            </p>

          </div>

          <script>
            window.addEventListener("load", function () {
              setTimeout(function () {
                window.location.href =
                  "spareshare://github/connected";
              }, 500);
            });
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    next(error);
  }
};


// Handle GitHub App lifecycle webhooks.
const handleGitHubWebhook = async (req, res, next) => {
  try {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const signature = req.get("x-hub-signature-256");

    if (!secret) {
      throw createError(
        "GitHub webhook secret is not configured.",
        500,
        "GITHUB_WEBHOOK_CONFIG_MISSING"
      );
    }

    if (!Buffer.isBuffer(req.rawBody) || !signature) {
      throw createError(
        "Missing raw webhook body or signature.",
        401,
        "GITHUB_WEBHOOK_SIGNATURE_MISSING"
      );
    }

    const expectedSignature =
      "sha256=" +
      crypto
        .createHmac("sha256", secret)
        .update(req.rawBody)
        .digest("hex");

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      )
    ) {
      throw createError(
        "Invalid GitHub webhook signature.",
        401,
        "GITHUB_WEBHOOK_SIGNATURE_INVALID"
      );
    }

    const event = req.get("x-github-event");
    const payload = req.body;

    // GitHub webhook ping.
    if (event === "ping") {
      return res.status(200).json({
        success: true,
        message: "GitHub webhook ping received.",
      });
    }

    // Only installation lifecycle events are handled.
    if (event !== "installation") {
      return res.status(200).json({
        success: true,
        message: "Webhook verified; event not handled.",
      });
    }

    const installation = payload?.installation;
    const installationId = installation?.id;
    const action = payload?.action;

    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0
    ) {
      throw createError(
        "Invalid installation ID in webhook payload.",
        400,
        "INVALID_GITHUB_INSTALLATION_ID"
      );
    }

    let update;

    switch (action) {
      case "deleted":
        update = {
          status: "uninstalled",
        };
        break;

      case "suspend":
        update = {
          status: "suspended",
        };
        break;

      case "unsuspend":
        update = {
          status: "active",
        };
        break;

      case "created":
      case "updated":
      case "new_permissions_accepted":
        update = {
          accountId: installation.account?.id,
          accountLogin: installation.account?.login,
          accountType: installation.target_type,
          repositorySelection: installation.repository_selection,
          permissions: {
            contents: installation.permissions?.contents || "read",
            metadata: installation.permissions?.metadata || "read",
          },
          status: installation.suspended_at
            ? "suspended"
            : "active",
          lastSyncedAt: new Date(),
        };
        break;

      default:
        return res.status(200).json({
          success: true,
          message: "Installation event verified; action not handled.",
        });
    }

    // Webhooks synchronize existing ownership links only.
    const result = await GitHubInstallation.updateOne(
      { installationId },
      { $set: update },
      { runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: result.matchedCount
        ? "GitHub installation synchronized."
        : "Webhook verified; installation is not linked yet.",
    });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  startGitHubInstallation,
  completeGitHubInstallation,
  handleGitHubWebhook,
};
