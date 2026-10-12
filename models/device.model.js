const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    deviceType: {
      type: String,
      enum: [
        "android",
        "linux",
        "windows",
        "macos",
        "raspberry-pi",
        "other",
      ],
      required: true,
      index: true,
    },

    os: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    osVersion: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    architecture: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    agentVersion: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "online",
        "offline",
        "degraded",
        "disabled",
      ],
      default: "pending",
      index: true,
    },

    lastSeenAt: {
      type: Date,
      index: true,
    },

    ipAddress: {
      type: String,
      trim: true,
    },

    macAddress: {
      type: String,
      trim: true,
    },

    hardware: {
      cpu: {
        model: {
          type: String,
          trim: true,
        },

        cores: {
          type: Number,
          min: 1,
        },
      },

      memoryMb: {
        type: Number,
        min: 0,
      },

      storageMb: {
        type: Number,
        min: 0,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

deviceSchema.index({
  userId: 1,
  name: 1,
},
{ 
  unique: true,
});

module.exports = mongoose.models.Device || mongoose.model("Device", deviceSchema);