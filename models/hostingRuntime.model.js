const mongoose = require("mongoose");

const deviceAgentCredentialSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
      unique: true,
      index: true,
    },

    tokenHash: {
      type: String,
      required: true,
      select: false,
    },

    tokenVersion: {
      type: Number,
      default: 1,
      min: 1,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastAuthenticatedAt: Date,

    revokedAt: Date,
    revokedReason: String,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);


const serverMonitoringStateSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      unique: true,
      index: true,
    },

    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
      index: true,
    },

    applicationStatus: {
      type: String,
      enum: [
        "unknown",
        "running",
        "stopped",
        "starting",
        "failed",
      ],
      default: "unknown",
    },

    tunnelStatus: {
      type: String,
      enum: [
        "unknown",
        "connected",
        "disconnected",
        "starting",
        "failed",
      ],
      default: "unknown",
    },

    tunnelUrl: {
      type: String,
      trim: true,
    },

    lastHeartbeatAt: Date,
    lastTunnelAt: Date,
    lastHealthCheckAt: Date,

    lastPublicEndpointStatus: {
      type: Number,
      default: null,
    },

    lastTunnelHttpStatus: {
      type: Number,
      default: null,
    },

    lastFailureType: {
      type: String,
      default: "none",
      index: true,
    },

    recoveryWindowStartedAt: Date,

    recoveryAttemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastRecoveryAt: Date,

    recoveryCooldownUntil: {
      type: Date,
      default: null,
      index: true,
    },

    lastRecoveryCommandId: {
      type: String,
      default: null,
    },

    schedulerLeaseUntil: {
      type: Date,
      default: null,
      index: true,
    },

    nextCheckAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    consecutiveFailures: {
      type: Number,
      default: 0,
      min: 0,
    },

    recoveryStatus: {
      type: String,
      enum: [
        "idle",
        "required",
        "in_progress",
        "recovered",
        "failed",
      ],
      default: "idle",
    },

    lastError: {
      type: String,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

serverMonitoringStateSchema.index({
  nextCheckAt: 1,
  schedulerLeaseUntil: 1,
});


const recoveryCommandSchema = new mongoose.Schema(
  {
    commandId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      index: true,
    },

    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
      index: true,
    },

    action: {
      type: String,
      enum: [
        "CHECK_APPLICATION",
        "START_APPLICATION",
        "RESTART_APPLICATION",
        "STOP_APPLICATION",
        "CHECK_TUNNEL",
        "RESTART_TUNNEL",
        "REPAIR_TUNNEL",
        "FULL_DIAGNOSTICS",
        "SYNC_ENV",
      ],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "sent",
        "acknowledged",
        "executing",
        "completed",
        "failed",
        "expired",
      ],
      default: "pending",
      index: true,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    error: {
      type: String,
      maxlength: 2000,
    },

    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    acknowledgedAt: Date,
    startedAt: Date,
    completedAt: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);


recoveryCommandSchema.index({
  deviceId: 1,
  status: 1,
  createdAt: 1,
});

recoveryCommandSchema.index({
  serverId: 1,
  createdAt: -1,
});


const DeviceAgentCredential =
  mongoose.models.DeviceAgentCredential ||
  mongoose.model(
    "DeviceAgentCredential",
    deviceAgentCredentialSchema
  );

const ServerMonitoringState =
  mongoose.models.ServerMonitoringState ||
  mongoose.model(
    "ServerMonitoringState",
    serverMonitoringStateSchema
  );

const RecoveryCommand =
  mongoose.models.RecoveryCommand ||
  mongoose.model(
    "RecoveryCommand",
    recoveryCommandSchema
  );


module.exports = {
  DeviceAgentCredential,
  ServerMonitoringState,
  RecoveryCommand,
};
