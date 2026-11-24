
const mongoose = require("mongoose");

const userDeviceMappingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },

    destinationLink: {
      type: String,
      required: true,
      trim: true,
    },

    priority: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  }
);

const serverEndpointSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      unique: true,
    },

    permanentLink: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      immutable: true,
    },

    redirectionLinks: {
      type: [userDeviceMappingSchema],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    configVersion: {
      type: Number,
      default: 1,
      min: 1,
    },

    routingMode: {
      type: String,
      enum: ["redirect", "proxy"],
      default: "proxy",
    },

    security: {
      enabled: {
        type: Boolean,
        default: true,
      },

      httpsOnly: {
        type: Boolean,
        default: true,
      },

      allowedMethods: {
        type: [String],
        default: [
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
        ],
      },

      rateLimitPerMinute: {
        type: Number,
        default: 120,
        min: 1,
      },
    },

    lastPublishedAt: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Validate unique user-device combinations
serverEndpointSchema.pre("validate", function () {
  const combinations = this.redirectionLinks.map(
    (link) =>
      `${link.userId?.toString()}_${link.deviceId?.toString()}`
  );

  if (new Set(combinations).size !== combinations.length) {
    this.invalidate(
      "redirectionLinks",
      "Duplicate user and device combinations are not allowed."
    );
  }
});

module.exports = mongoose.models.ServerEndpoint || mongoose.model("ServerEndpoint", serverEndpointSchema);