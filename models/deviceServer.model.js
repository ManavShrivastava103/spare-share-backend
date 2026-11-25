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

    onPort: {
      type: Number,
      required: true,
      min: 3000,
      max: 65535,
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

// A port can only be assigned once per device.
// Includes assignments with status "removed".
deviceServerSchema.index(
  {
    deviceId: 1,
    onPort: 1,
  },
  {
    unique: true,
    name: "unique_device_port",
  }
);

module.exports = mongoose.model("DeviceServer", deviceServerSchema);