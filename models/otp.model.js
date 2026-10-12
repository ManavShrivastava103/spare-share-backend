
const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    otpHash: {
      type: String,
      required: true,
      select: false,
    },

    purpose: {
      type: String,
      enum: [
        "email-verification",
        "login",
        "forgot-password",
      ],
      required: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);


otpSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
  }
);

otpSchema.index({
  email: 1,
  purpose: 1,
  createdAt: -1,
});

module.exports = mongoose.model("OTP", otpSchema);