const mongoose = require("mongoose");

const environmentVersionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    type: {
      type: String,
      enum: [
        "node",
        "python",
        "java",
        "php",
        "dotnet",
        "go",
        "ruby",
        "rust",
        "cpp",
        "kotlin",
      ],
      required: true,
      index: true,
    },

    version: {
      type: String,
      required: true,
      trim: true,
    },

    packageManager: {
      type: String,
      trim: true,
    },

    packageManagerVersion: {
      type: String,
      trim: true,
    },

    dockerImage: {
      type: String,
      trim: true,
    },

    supportedArchitectures: {
      type: [String],
      default: ["amd64"],
    },

    minimumMemoryMb: {
      type: Number,
      min: 16,
    },

    isLTS: {
      type: Boolean,
      default: false,
    },

    isStable: {
      type: Boolean,
      default: true,
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

environmentVersionSchema.index(
  {
    type: 1,
    version: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model("EnvironmentVersion", environmentVersionSchema);