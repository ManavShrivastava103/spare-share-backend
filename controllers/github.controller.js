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

    // Expire the state after 10 minutes.
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



const completeGitHubInstallation = async (req, res, next) => {
  try {
    const { installation_id, setup_action, state } = req.query;

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

    const stateHash = crypto
      .createHash("sha256")
      .update(state)
      .digest("hex");

    // Atomically consume the state once, only if it has not expired.
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

    // Verify this installation belongs to our configured GitHub App.
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

    const existingInstallation =
      await GitHubInstallation.findOne({ installationId });

    // Never let a callback reassign another user's installation.
    if (
      existingInstallation &&
      String(existingInstallation.userId) !== String(savedState.userId)
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

    return res.status(200).json({
      success: true,
      message: "GitHub App installation connected successfully.",
      installation: {
        installationId,
        accountLogin: details.accountLogin,
        accountType: details.accountType,
        status: details.suspendedAt ? "suspended" : "active",
      },
    });
  } catch (error) {
    next(error);
  }
};


const handleGitHubWebhook = async (req, res, next) => {
  try {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const signature = req.get("x-hub-signature-256");

    if (!secret) {
      const error = new Error("GitHub webhook secret is not configured.");
      error.statusCode = 500;
      error.code = "GITHUB_WEBHOOK_CONFIG_MISSING";
      throw error;
    }

    if (!Buffer.isBuffer(req.rawBody) || !signature) {
      const error = new Error("Missing raw webhook body or signature.");
      error.statusCode = 401;
      error.code = "GITHUB_WEBHOOK_SIGNATURE_MISSING";
      throw error;
    }

    const expectedSignature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      const error = new Error("Invalid GitHub webhook signature.");
      error.statusCode = 401;
      error.code = "GITHUB_WEBHOOK_SIGNATURE_INVALID";
      throw error;
    }

    const event = req.get("x-github-event");
    const payload = req.body;

    // GitHub sends this event when testing a webhook.
    if (event === "ping") {
      return res.status(200).json({
        success: true,
        message: "GitHub webhook ping received.",
      });
    }

    // We currently synchronize installation lifecycle events only.
    if (event !== "installation") {
      return res.status(200).json({
        success: true,
        message: "Webhook verified; event not handled.",
      });
    }

    const installation = payload?.installation;
    const installationId = installation?.id;
    const action = payload?.action;

    if (!installationId || !Number.isSafeInteger(installationId)) {
      const error = new Error("Invalid installation ID in webhook payload.");
      error.statusCode = 400;
      error.code = "INVALID_GITHUB_INSTALLATION_ID";
      throw error;
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
          status: installation.suspended_at ? "suspended" : "active",
          lastSyncedAt: new Date(),
        };
        break;

      default:
        return res.status(200).json({
          success: true,
          message: "Installation event verified; action not handled.",
        });
    }

    // Never create an ownership link from a webhook alone.
    // The authenticated setup callback establishes user ownership.
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
