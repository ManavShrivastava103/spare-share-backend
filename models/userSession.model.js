const mongoose = require("mongoose");

const userSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    clientDeviceId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    ipAddress: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    status: {
      type: String,
      enum: ["active", "revoked", "expired"],
      default: "active",
      index: true,
    },

    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    revokedAt: {
      type: Date,
    },

    revokedReason: {
      type: String,
      trim: true,
      maxlength: 255,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);


userSessionSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
  }
);

userSessionSchema.index({
  userId: 1,
  status: 1,
  lastActiveAt: -1,
});

module.exports = mongoose.model("UserSession", userSessionSchema);