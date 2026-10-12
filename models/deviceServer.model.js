const mongoose = require("mongoose");

const deviceServerSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },

    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },

    status: {
      type: String,
      enum: [
        "assigned",
        "starting",
        "running",
        "stopped",
        "failed",
        "removed",
      ],
      default: "assigned",
      index: true,
    },

    assignedAt: {
      type: Date,
      default: Date.now,
    },

    lastStartedAt: {
      type: Date,
    },

    priority: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

deviceServerSchema.index(
  {
    deviceId: 1,
    serverId: 1,
  },
  {
    unique: true,
  }
);

deviceServerSchema.index({
  serverId: 1,
  status: 1,
});

deviceServerSchema.index({
  deviceId: 1,
  status: 1,
});

module.exports = mongoose.model("DeviceServer", deviceServerSchema);