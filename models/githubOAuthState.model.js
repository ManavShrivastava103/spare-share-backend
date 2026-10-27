
const mongoose = require("mongoose");
const crypto = require("crypto");

const githubOAuthStateSchema = new mongoose.Schema(
  {
    stateHash: {
      type: String,
      required: true,
      unique: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

githubOAuthStateSchema.statics.generateState = function () {
  return crypto.randomBytes(32).toString("hex");
};

module.exports = mongoose.model("GitHubOAuthState", githubOAuthStateSchema);
