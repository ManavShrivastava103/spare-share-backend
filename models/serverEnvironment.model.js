
const mongoose = require("mongoose");

const serverEnvironmentSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      unique: true,
      index: true,
    },

    encryptedData: {
      type: String,
      required: true,
      select: false,
    },

    iv: {
      type: String,
      required: true,
      select: false,
    },

    authTag: {
      type: String,
      required: true,
      select: false,
    },

    keyVersion: {
      type: Number,
      required: true,
      default: 1,
    },

    revision: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports =
  mongoose.models.ServerEnvironment ||
  mongoose.model("ServerEnvironment", serverEnvironmentSchema);
