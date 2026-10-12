const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },

    roleType: {
      type: String,
      enum: ["Student", "Developer", "Business Owner", "Enthusiast", "Other"],
    },

    passwordHash: {
      type: String,
      select: false,
    },

    lastPassword: {
      type: String,
      select: false,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    isPremium: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastLoginAt: {
      type: Date,
    },

    devices: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
    }],

    consent: {
      termsAccepted: {type: Boolean, default: false,},
      privacyPolicyAccepted: {type: Boolean, default: false,},
      acceptedAt: {type: Date,},
      version: {type: String,},
    },

  },
  { timestamps: true, versionKey: false, }
);

module.exports = mongoose.model("User", userSchema);