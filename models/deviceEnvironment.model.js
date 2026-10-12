const mongoose = require("mongoose");

const deviceEnvironmentSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },

    environmentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnvironmentVersion",
      required: true,
    },

    installedAt: {
      type: Date,
      default: Date.now,
    },

    status: {
      type: String,
      enum: [
        "installing",
        "installed",
        "failed",
        "removing",
      ],
      default: "installing",
      index: true,
    },

    environmentPath: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

deviceEnvironmentSchema.index(
  {
    deviceId: 1,
    environmentVersionId: 1,
  },
  {
    unique: true,
  }
);

deviceEnvironmentSchema.index({
  environmentVersionId: 1,
  status: 1,
});

module.exports =
  mongoose.models.DeviceEnvironment ||
  mongoose.model(
    "DeviceEnvironment",
    deviceEnvironmentSchema
  );