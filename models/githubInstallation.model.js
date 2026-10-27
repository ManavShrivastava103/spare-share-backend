
const mongoose = require("mongoose");

const githubInstallationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    installationId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },

    accountId: {
      type: Number,
      required: true,
    },

    accountLogin: {
      type: String,
      required: true,
      trim: true,
    },

    accountType: {
      type: String,
      enum: ["User", "Organization"],
      required: true,
    },

    repositorySelection: {
      type: String,
      enum: ["all", "selected"],
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "suspended", "uninstalled"],
      default: "active",
      index: true,
    },

    permissions: {
      contents: {
        type: String,
        default: "read",
      },
      metadata: {
        type: String,
        default: "read",
      },
    },

    installedAt: {
      type: Date,
      default: Date.now,
    },

    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model(
  "GitHubInstallation",
  githubInstallationSchema
);
