const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema(
  {
    owner: {
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

    collaborators: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      required: true,
      index: true,
    },

    slug: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: [
        "creating",
        "stopped",
        "starting",
        "running",
        "stopping",
        "failed",
        "deleted",
      ],
      default: "creating",
      index: true,
    },

    visibility: {
      type: String,
      enum: ["private", "public"],
      default: "private",
    },

    port: {
      type: Number,
      min: 1,
      max: 65535,
    },

    environmentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnvironmentVersion",
    },

    uploadType: {
        type: String,
        enum: ["git", "zip"],
    },

    repository: {
      provider: {
        type: String,
        enum: [
          "github",
          "gitlab",
          "bitbucket",
          "other",
        ],
      },

      repositoryUrl: {
        type: String,
        trim: true,
      },

      branch: {
        type: String,
        trim: true,
        default: "main",
      },

      autoDeploy: {
        type: Boolean,
        default: false,
      },

      isPrivate: {
        type: Boolean,
        default: false,
      },
    },

    resources: {
      cpuLimitPercent: {
        type: Number,
        min: 1,
        max: 100,
      },

      memoryLimitMb: {
        type: Number,
        min: 16,
      },

      storageLimitMb: {
        type: Number,
        min: 1,
      },
    },

    startedAt: {
      type: Date,
    },

    stoppedAt: {
      type: Date,
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

serverSchema.index(
  {
    owner: 1,
    slug: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model("Server", serverSchema);