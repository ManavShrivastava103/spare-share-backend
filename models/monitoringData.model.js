const mongoose = require("mongoose");

const monitoringDataSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      unique: true,
      index: true,
    },

    health: {
      type: String,
      enum: [
        "healthy",
        "degraded",
        "down",
        "unknown",
      ],
      default: "unknown",
      index: true,
    },

    cpu: {
      usagePercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },

      loadAverage: {
        type: Number,
        min: 0,
      },
    },

    memory: {
      usageMb: {
        type: Number,
        min: 0,
        default: 0,
      },

      totalMb: {
        type: Number,
        min: 0,
        default: 0,
      },

      usagePercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
    },

    storage: {
      usedMb: {
        type: Number,
        min: 0,
        default: 0,
      },

      totalMb: {
        type: Number,
        min: 0,
        default: 0,
      },

      usagePercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
    },

    network: {
      uploadBytes: {
        type: Number,
        min: 0,
        default: 0,
      },

      downloadBytes: {
        type: Number,
        min: 0,
        default: 0,
      },
    },

    uptimeSeconds: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastHeartbeatAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: false,
      updatedAt: true,
    },

    versionKey: false,
  }
);

module.exports =
  mongoose.models.MonitoringData ||
  mongoose.model(
    "MonitoringData",
    monitoringDataSchema
  );