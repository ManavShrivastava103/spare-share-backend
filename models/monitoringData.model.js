
const mongoose = require("mongoose");

// Per-minute traffic bucket
const minuteBucketSchema = new mongoose.Schema(
  {
    minute: {
      type: Date,
      required: true,
    },

    requests: {
      type: Number,
      default: 0,
      min: 0,
    },

    successfulRequests: {
      type: Number,
      default: 0,
      min: 0,
    },

    failedRequests: {
      type: Number,
      default: 0,
      min: 0,
    },

    bytesIn: {
      type: Number,
      default: 0,
      min: 0,
    },

    bytesOut: {
      type: Number,
      default: 0,
      min: 0,
    },

    responseTimeMs: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// Per-endpoint traffic statistics
const endpointStatSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    path: {
      type: String,
      required: true,
      trim: true,
    },

    requests: {
      type: Number,
      default: 0,
      min: 0,
    },

    successfulRequests: {
      type: Number,
      default: 0,
      min: 0,
    },

    failedRequests: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalResponseTimeMs: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastCalledAt: {
      type: Date,
    },
  },
  { _id: false }
);

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
      enum: ["healthy", "degraded", "down", "unknown"],
      default: "unknown",
      index: true,
    },

    // CPU resource metrics
    cpu: {
      usagePercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },

      totalCores: {
        type: Number,
        min: 1,
      },

      loadAverage: {
        type: Number,
        min: 0,
      },
    },

    // RAM resource metrics
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

    // Storage resource metrics
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

    // Network resource metrics
    network: {
      // Cumulative transferred data
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

      // Current measured transfer rates
      uploadBytesPerSecond: {
        type: Number,
        min: 0,
        default: 0,
      },

      downloadBytesPerSecond: {
        type: Number,
        min: 0,
        default: 0,
      },
    },

    // Total server uptime
    uptimeSeconds: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Traffic totals collected by the permanent endpoint proxy
    traffic: {
      totalRequests: {
        type: Number,
        default: 0,
        min: 0,
      },

      successfulRequests: {
        type: Number,
        default: 0,
        min: 0,
      },

      failedRequests: {
        type: Number,
        default: 0,
        min: 0,
      },

      bytesIn: {
        type: Number,
        default: 0,
        min: 0,
      },

      bytesOut: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalResponseTimeMs: {
        type: Number,
        default: 0,
        min: 0,
      },

      // HTTP method-wise request counts
      methods: {
        type: Map,
        of: Number,
        default: {},
      },

      // Retain only the latest 60 minute buckets
      minuteBuckets: {
        type: [minuteBucketSchema],
        default: [],
      },

      // Retain at most 100 distinct endpoint paths
      endpointStats: {
        type: [endpointStatSchema],
        default: [],
      },
    },

    // Last successful device monitoring update
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

module.exports = mongoose.models.MonitoringData || mongoose.model("MonitoringData", monitoringDataSchema);
