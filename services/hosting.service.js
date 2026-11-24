const crypto = require("crypto");
const mongoose = require("mongoose");

const Device = require("../models/device.model");
const Server = require("../models/server.model");
const DeviceServer = require("../models/deviceServer.model");
const ServerEndpoint = require("../models/serverEndpoint.model");

const {
  DeviceAgentCredential,
  ServerMonitoringState,
  RecoveryCommand,
} = require("../models/hostingRuntime.model");


const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};


const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};


const hashAgentToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};


const generateAgentToken = () => {
  return `ss_agent_${crypto.randomBytes(48).toString("hex")}`;
};


const safeCompare = (a, b) => {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  if (first.length !== second.length) {
    return false;
  }

  return crypto.timingSafeEqual(first, second);
};


// Verify the agent token and identify the device.
const authenticateAgentToken = async (token) => {
  if (
    typeof token !== "string" ||
    !/^ss_agent_[a-f0-9]{96}$/.test(token)
  ) {
    throw createError(
      "Invalid device-agent credentials.",
      401,
      "INVALID_AGENT_CREDENTIALS"
    );
  }

  const tokenHash = hashAgentToken(token);

  const credential = await DeviceAgentCredential
    .findOne({
      tokenHash,
      isActive: true,
    })
    .select("+tokenHash");

  if (!credential || !safeCompare(credential.tokenHash, tokenHash)) {
    throw createError(
      "Device-agent credentials are invalid or revoked.",
      401,
      "AGENT_AUTHENTICATION_FAILED"
    );
  }

  const device = await Device.findOne({
    _id: credential.deviceId,
    isActive: true,
  });

  if (!device) {
    throw createError(
      "The registered device is unavailable.",
      403,
      "DEVICE_UNAVAILABLE"
    );
  }

  credential.lastAuthenticatedAt = new Date();
  await credential.save();

  return {
    device,
    credential,
  };
};


// Verify that a device is assigned to a server.
const assertDeviceServerAssignment = async (
  deviceId,
  serverId
) => {
  if (
    !isValidObjectId(deviceId) ||
    !isValidObjectId(serverId)
  ) {
    throw createError(
      "Invalid device or server identifier.",
      400,
      "INVALID_DEVICE_SERVER_ID"
    );
  }

  const assignment = await DeviceServer.findOne({
    deviceId,
    serverId,
    status: { $ne: "removed" },
  });

  if (!assignment) {
    throw createError(
      "This device is not assigned to the requested server.",
      403,
      "DEVICE_SERVER_ASSIGNMENT_NOT_FOUND"
    );
  }

  const server = await Server.findOne({
    _id: serverId,
    isActive: true,
  });

  if (!server) {
    throw createError(
      "Server not found or inactive.",
      404,
      "SERVER_NOT_FOUND"
    );
  }

  return {
    assignment,
    server,
  };
};


// Validate Cloudflare Quick Tunnel URLs.
// Do not accept arbitrary destinations from a device.
const validateQuickTunnelUrl = (value) => {
  if (
    typeof value !== "string" ||
    value.length > 500
  ) {
    throw createError(
      "A valid tunnel URL is required.",
      400,
      "INVALID_TUNNEL_URL"
    );
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw createError(
      "Tunnel URL is not a valid URL.",
      400,
      "INVALID_TUNNEL_URL"
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  const validHostname =
    hostname === "trycloudflare.com" ||
    hostname.endsWith(".trycloudflare.com");

  if (
    parsed.protocol !== "https:" ||
    !validHostname ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw createError(
      "Only HTTPS Cloudflare Quick Tunnel URLs are accepted.",
      400,
      "UNTRUSTED_TUNNEL_URL"
    );
  }

  return parsed.origin;
};


// Provision or rotate the credential for a device.
// The raw token is returned only once.
const provisionAgentCredential = async ({
  deviceId,
  userId,
}) => {
  if (
    !isValidObjectId(deviceId) ||
    !isValidObjectId(userId)
  ) {
    throw createError(
      "Invalid device or user identifier.",
      400,
      "INVALID_IDENTIFIER"
    );
  }

  const device = await Device.findOne({
    _id: deviceId,
    userId,
    isActive: true,
  });

  if (!device) {
    throw createError(
      "Device not found for this account.",
      404,
      "DEVICE_NOT_FOUND"
    );
  }

  const token = generateAgentToken();
  const tokenHash = hashAgentToken(token);

  await DeviceAgentCredential.findOneAndUpdate(
    { deviceId },
    {
      $set: {
        tokenHash,
        isActive: true,
        revokedAt: null,
        revokedReason: null,
      },
      $inc: {
        tokenVersion: 1,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

  return {
    deviceId: device._id,
    agentToken: token,
    tokenType: "Bearer",
  };
};


// Update the permanent endpoint's existing destination mapping.
const updateTunnelDestination = async ({
  device,
  serverId,
  tunnelUrl,
}) => {
  const validatedUrl = validateQuickTunnelUrl(tunnelUrl);

  const { assignment } = await assertDeviceServerAssignment(
    device._id,
    serverId
  );

  const endpoint = await ServerEndpoint.findOne({
    serverId,
    isActive: true,
  });

  if (!endpoint) {
    throw createError(
      "A permanent endpoint has not been created for this server.",
      404,
      "SERVER_ENDPOINT_NOT_FOUND"
    );
  }

  const mappingIndex = endpoint.redirectionLinks.findIndex(
    (link) =>
      String(link.deviceId) === String(device._id) &&
      String(link.userId) === String(device.userId)
  );

  if (mappingIndex >= 0) {
    endpoint.redirectionLinks[mappingIndex].destinationLink = validatedUrl;
    endpoint.redirectionLinks[mappingIndex].isActive = true;
  } else {
    endpoint.redirectionLinks.push({
      userId: device.userId,
      deviceId: device._id,
      destinationLink: validatedUrl,
      priority: Math.max(1, assignment.priority || 1),
      isActive: true,
    });
  }

  endpoint.configVersion = Number(endpoint.configVersion || 0) + 1;
  // Ensure all permanent endpoint traffic goes through the backend proxy.
  endpoint.routingMode = "proxy";
  await endpoint.save();
  await ServerMonitoringState.findOneAndUpdate(
    {
      serverId,
    },
    {
      $set: {
        deviceId: device._id,
        tunnelUrl: validatedUrl,
        tunnelStatus: "connected",
        lastTunnelAt: new Date(),
        lastError: null,
      },
      $setOnInsert: {
        applicationStatus: "unknown",
        recoveryStatus: "idle",
        consecutiveFailures: 0,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

  return {
    tunnelUrl: validatedUrl,
    permanentLink: endpoint.permanentLink,
    configVersion: endpoint.configVersion,
  };
};


// Update device presence and reported server state.
const processHeartbeat = async ({
  device,
  payload,
}) => {
  const now = new Date();

  await Device.updateOne(
    { _id: device._id },
    {
      $set: {
        status: "online",
        lastSeenAt: now,
        agentVersion: payload.agentVersion || device.agentVersion,
      },
    }
  );

  const serverReports = Array.isArray(payload.servers)
    ? payload.servers
    : [];

  if (serverReports.length > 50) {
    throw createError(
      "Too many server reports in one heartbeat.",
      400,
      "TOO_MANY_SERVER_REPORTS"
    );
  }

  const updatedServers = [];

  for (const report of serverReports) {
    if (!report || !isValidObjectId(report.serverId)) {
      continue;
    }

    await assertDeviceServerAssignment(
      device._id,
      report.serverId
    );

    const allowedApplicationStatuses = [
      "unknown",
      "running",
      "stopped",
      "starting",
      "failed",
    ];

    const allowedTunnelStatuses = [
      "unknown",
      "connected",
      "disconnected",
      "starting",
      "failed",
    ];

    const applicationStatus =
      allowedApplicationStatuses.includes(report.applicationStatus)
        ? report.applicationStatus
        : "unknown";

    const tunnelStatus =
      allowedTunnelStatuses.includes(report.tunnelStatus)
        ? report.tunnelStatus
        : "unknown";

    const state = await ServerMonitoringState.findOneAndUpdate(
      {
        serverId: report.serverId,
      },
      {
        $set: {
          deviceId: device._id,
          applicationStatus,
          tunnelStatus,
          lastHeartbeatAt: now,
          lastError:
            typeof report.error === "string"
              ? report.error.slice(0, 1000)
              : null,
        },
        $setOnInsert: {
          recoveryStatus: "idle",
          consecutiveFailures: 0,
          nextCheckAt: now,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    updatedServers.push({
      serverId: report.serverId,
      applicationStatus: state.applicationStatus,
      tunnelStatus: state.tunnelStatus,
    });
  }

  return {
    deviceId: device._id,
    lastSeenAt: now,
    updatedServers,
  };
};


// Fetch server configuration assigned to this device.
const getDeviceConfiguration = async (device) => {
  const assignments = await DeviceServer.find({
    deviceId: device._id,
    status: { $ne: "removed" },
  })
    .populate({
      path: "serverId",
      select: "name slug status port monitoringEnabled",
    })
    .lean();

  return assignments
    .filter((item) => item.serverId)
    .map((item) => ({
      serverId: item.serverId._id,
      name: item.serverId.name,
      slug: item.serverId.slug,
      status: item.serverId.status,
      port: item.serverId.port,
      monitoringEnabled: item.serverId.monitoringEnabled,
      assignmentStatus: item.status,
      priority: item.priority,
    }));
};


// Poll pending commands for a device.
const getPendingCommands = async (device) => {
  const now = new Date();

  await RecoveryCommand.updateMany(
    {
      deviceId: device._id,
      status: {
        $in: ["pending", "sent", "acknowledged", "executing"],
      },
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: "expired",
        error: "Command expired before completion.",
      },
    }
  );

  const pending = await RecoveryCommand.find({
    deviceId: device._id,
    status: "pending",
    expiresAt: { $gt: now },
  })
    .sort({ createdAt: 1 })
    .limit(20);

  const commands = [];

  for (const command of pending) {
    const claimed = await RecoveryCommand.findOneAndUpdate(
      {
        _id: command._id,
        deviceId: device._id,
        status: "pending",
      },
      {
        $set: {
          status: "sent",
        },
      },
      {
        new: true,
      }
    );

    if (claimed) {
      commands.push(claimed);
    }
  }

  return commands;
};


// Create a command after verifying server ownership and assignment.
const createRecoveryCommand = async ({
  userId,
  serverId,
  deviceId,
  action,
  payload = {},
}) => {
  const allowedActions = [
    "CHECK_APPLICATION",
    "START_APPLICATION",
    "RESTART_APPLICATION",
    "STOP_APPLICATION",
    "CHECK_TUNNEL",
    "RESTART_TUNNEL",
    "REPAIR_TUNNEL",
    "FULL_DIAGNOSTICS",
    "SYNC_ENV",
  ];

  if (!allowedActions.includes(action)) {
    throw createError(
      "Unsupported recovery command.",
      400,
      "INVALID_RECOVERY_ACTION"
    );
  }

  const server = await Server.findOne({
    _id: serverId,
    owner: userId,
    isActive: true,
  });

  if (!server) {
    throw createError(
      "Server not found or you do not own it.",
      404,
      "SERVER_NOT_FOUND"
    );
  }

  await assertDeviceServerAssignment(deviceId, serverId);

  const device = await Device.findOne({
    _id: deviceId,
    isActive: true,
  });

  if (!device || String(device.userId) !== String(userId)) {
    throw createError(
      "Device is not available to this account.",
      403,
      "DEVICE_ACCESS_DENIED"
    );
  }

  const command = await RecoveryCommand.create({
    commandId: crypto.randomUUID(),
    serverId,
    deviceId,
    action,
    payload,
    status: "pending",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  return command;
};


// Report command execution result.
const reportCommandResult = async ({
  device,
  commandId,
  status,
  result,
  error,
}) => {
  if (!["acknowledged", "executing", "completed", "failed"].includes(status)) {
    throw createError(
      "Invalid command result status.",
      400,
      "INVALID_COMMAND_STATUS"
    );
  }

  const command = await RecoveryCommand.findOne({
    commandId,
    deviceId: device._id,
  });

  if (!command) {
    throw createError(
      "Command not found for this device.",
      404,
      "COMMAND_NOT_FOUND"
    );
  }

  if (
    ["completed", "failed", "expired"].includes(command.status)
  ) {
    throw createError(
      "This command has already reached a final state.",
      409,
      "COMMAND_ALREADY_FINISHED"
    );
  }

  if (status === "acknowledged") {
    command.acknowledgedAt = new Date();
  }

  if (status === "executing") {
    command.startedAt = command.startedAt || new Date();
  }

  if (status === "completed" || status === "failed") {
    command.completedAt = new Date();
  }

  command.status = status;

  if (result !== undefined) {
    command.result = result;
  }

  if (error !== undefined) {
    command.error = String(error).slice(0, 2000);
  }

  await command.save();

  return command;
};



// ============================================================
// AUTOMATIC MONITORING CONFIGURATION
// ============================================================

const getMonitoringConfig = () => ({
  intervalMs: Number(
    process.env.MONITORING_INTERVAL_MS || 30000
  ),

  timeoutMs: Number(
    process.env.MONITORING_TIMEOUT_MS || 5000
  ),

  heartbeatStaleMs: Number(
    process.env.MONITORING_HEARTBEAT_STALE_MS || 90000
  ),

  failureThreshold: Number(
    process.env.MONITORING_FAILURE_THRESHOLD || 3
  ),

  recoveryCooldownMs: Number(
    process.env.MONITORING_RECOVERY_COOLDOWN_MS || 300000
  ),

  recoveryWindowMs: Number(
    process.env.MONITORING_RECOVERY_WINDOW_MS || 1800000
  ),

  maxRecoveryAttempts: Number(
    process.env.MONITORING_MAX_RECOVERY_ATTEMPTS || 3
  ),

  batchSize: Number(
    process.env.MONITORING_BATCH_SIZE || 10
  ),

  leaseMs: Number(
    process.env.MONITORING_LEASE_MS || 60000
  ),
});


// ============================================================
// HTTP HEALTH PROBE
// ============================================================

const probeHttpUrl = async (url, timeoutMs) => {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),

      headers: {
        "User-Agent": "SpareShare-Monitor/1.0",
      },
    });

    return {
      reachable: true,
      status: response.status,
      healthy: response.status < 500,
      error: null,
    };

  } catch (error) {
    return {
      reachable: false,
      status: null,
      healthy: false,
      error: error.name === "TimeoutError"
        ? "Health check timed out."
        : error.message,
    };
  }
};


// ============================================================
// FAILURE CLASSIFICATION
// ============================================================

const classifyMonitoringFailure = ({
  deviceIsOnline,
  endpointProbe,
  tunnelProbe,
}) => {

  if (!deviceIsOnline) {
    return "device_unreachable";
  }

  if (!tunnelProbe.reachable) {
    return "tunnel_unreachable";
  }

  if (
    [502, 503, 504].includes(tunnelProbe.status)
  ) {
    return "tunnel_upstream_error";
  }

  if (tunnelProbe.status >= 500) {
    return "application_http_error";
  }

  if (
    !endpointProbe.reachable ||
    endpointProbe.status >= 500
  ) {
    return "permanent_endpoint_failure";
  }

  return "none";
};


// ============================================================
// AUTOMATIC RECOVERY COMMAND CREATION
// ============================================================

const queueAutomatedRecoveryCommand = async ({
  state,
  device,
  failureType,
  endpointProbe,
  tunnelProbe,
  deviceIsOnline,
}) => {
  const now = new Date();
  const config = getMonitoringConfig();

  // A device that cannot communicate with the backend
  // cannot receive a recovery command.
  if (!deviceIsOnline) {
    state.recoveryStatus = "required";
    state.lastError =
      "Device is unreachable. Waiting for device connectivity.";

    await state.save();
    return null;
  }

  // Do not queue another command while an earlier
  // recovery command is still active.
  const activeCommand = await RecoveryCommand.findOne({
    serverId: state.serverId,
    deviceId: device._id,
    status: {
      $in: [
        "pending",
        "sent",
        "acknowledged",
        "executing",
      ],
    },
    expiresAt: { $gt: now },
  });

  if (activeCommand) {
    state.recoveryStatus = "in_progress";
    state.lastRecoveryCommandId = activeCommand.commandId;

    await state.save();
    return activeCommand;
  }

  // Respect the recovery cooldown.
  if (
    state.recoveryCooldownUntil &&
    state.recoveryCooldownUntil > now
  ) {
    state.recoveryStatus = "required";
    await state.save();
    return null;
  }

  // Reset the recovery attempt window when it expires.
  const windowExpired =
    !state.recoveryWindowStartedAt ||
    now.getTime() - new Date(
      state.recoveryWindowStartedAt
    ).getTime() >= config.recoveryWindowMs;

  if (windowExpired) {
    state.recoveryWindowStartedAt = now;
    state.recoveryAttemptCount = 0;
  }

  // Limit automatic recovery attempts.
  if (
    state.recoveryAttemptCount >= config.maxRecoveryAttempts
  ) {
    state.recoveryStatus = "failed";
    state.lastError =
      "Maximum automatic recovery attempts reached.";

    await state.save();
    return null;
  }

   let action = null;

  if (!state.tunnelUrl) {
    action = "REPAIR_TUNNEL";
  } else if (state.applicationStatus === "stopped") {
    action = "START_APPLICATION";
  } else if (
    state.tunnelStatus === "disconnected" ||
    state.tunnelStatus === "failed" ||
    failureType === "tunnel_unreachable"
  ) {
    action = "RESTART_TUNNEL";
  } else if (failureType === "tunnel_upstream_error") {
    action = "CHECK_TUNNEL";
  } else if (failureType === "application_http_error") {
    action = "CHECK_APPLICATION";
  } else if (failureType === "permanent_endpoint_failure") {
    state.recoveryStatus = "required";
    await state.save();
    return null;
  } else {
    action = "FULL_DIAGNOSTICS";
  }

  // Verify the assignment still exists.
  await assertDeviceServerAssignment(
    device._id,
    state.serverId
  );

  const commandId = crypto.randomUUID();

  const command = await RecoveryCommand.create({
    commandId,
    serverId: state.serverId,
    deviceId: device._id,
    action,

    payload: {
      source: "automatic_monitoring",
      failureType,
      consecutiveFailures: state.consecutiveFailures,
      endpointStatus: endpointProbe.status,
      tunnelStatus: tunnelProbe.status,
    },

    status: "pending",
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
  });

  // Record recovery attempt and cooldown.
  state.recoveryAttemptCount += 1;
  state.lastRecoveryAt = now;

  state.recoveryCooldownUntil = new Date(
    now.getTime() + config.recoveryCooldownMs
  );

  state.lastRecoveryCommandId = commandId;
  state.recoveryStatus = "in_progress";

  await state.save();

  console.log(
    `[SpareShare Monitor] Queued ${action} for server ${state.serverId}`
  );

  return command;
};




// ============================================================
// PROCESS ONE SERVER MONITORING STATE
// ============================================================

const processMonitoringState = async (state) => {
  const config = getMonitoringConfig();
  const now = new Date();

  try {
    const [server, device, endpoint] = await Promise.all([
      Server.findOne({
        _id: state.serverId,
        isActive: true,
      }),

      Device.findOne({
        _id: state.deviceId,
        isActive: true,
      }),

      ServerEndpoint.findOne({
        serverId: state.serverId,
        isActive: true,
      }),
    ]);

    if (!server || !server.monitoringEnabled) {
      return;
    }

    const deviceLastSeen = device?.lastSeenAt
      ? new Date(device.lastSeenAt).getTime()
      : 0;

    const deviceIsOnline =
      Boolean(device) &&
      Number.isFinite(deviceLastSeen) &&
      now.getTime() - deviceLastSeen <= config.heartbeatStaleMs;

    // --------------------------------------------------------
    // CHECK 1: PERMANENT SPARESHARE ENDPOINT
    // --------------------------------------------------------

    const endpointProbe = endpoint?.permanentLink
      ? await probeHttpUrl(
          endpoint.permanentLink,
          config.timeoutMs
        )
      : {
          reachable: false,
          status: null,
          healthy: false,
          error: "Permanent endpoint is missing.",
        };

    // --------------------------------------------------------
    // CHECK 2: CLOUDFLARE QUICK TUNNEL
    // --------------------------------------------------------

    let tunnelProbe = {
      reachable: false,
      status: null,
      healthy: false,
      error: "Tunnel URL is missing.",
    };

    if (state.tunnelUrl) {
      try {
        const tunnelUrl = validateQuickTunnelUrl(
          state.tunnelUrl
        );

        tunnelProbe = await probeHttpUrl(
          `${tunnelUrl}/`,
          config.timeoutMs
        );

      } catch (error) {
        tunnelProbe.error = error.message;
      }
    }

    // --------------------------------------------------------
    // CLASSIFY FAILURE
    // --------------------------------------------------------

    const failureType = classifyMonitoringFailure({
      deviceIsOnline,
      endpointProbe,
      tunnelProbe,
    });

    const failed = failureType !== "none";

    state.lastHealthCheckAt = now;
    state.lastPublicEndpointStatus = endpointProbe.status;
    state.lastTunnelHttpStatus = tunnelProbe.status;
    state.lastFailureType = failureType;

    state.consecutiveFailures = failed
      ? state.consecutiveFailures + 1
      : 0;

    // A successful direct tunnel probe confirms connectivity.
    if (tunnelProbe.reachable && tunnelProbe.status < 500) {
      state.tunnelStatus = "connected";
      state.lastTunnelAt = now;
    }

    if (!failed) {
      state.lastError = null;

      state.recoveryStatus = [
        "required",
        "in_progress",
        "failed",
      ].includes(state.recoveryStatus)
        ? "recovered"
        : "idle";

      // Reset the recovery window after successful recovery.
      state.recoveryAttemptCount = 0;
      state.recoveryWindowStartedAt = null;
      state.recoveryCooldownUntil = null;

    } else {
      state.lastError = [
        endpointProbe.error,
        tunnelProbe.error,
        failureType,
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1000);
    }

    await state.save();

    // --------------------------------------------------------
    // RECOVERY DECISION
    // --------------------------------------------------------

    if (
      failed &&
      state.consecutiveFailures >= config.failureThreshold
    ) {
      state.recoveryStatus = "required";
      await state.save();

      await queueAutomatedRecoveryCommand({
        state,
        device,
        failureType,
        endpointProbe,
        tunnelProbe,
        deviceIsOnline,
      });
    }

    console.log(
      `[SpareShare Monitor] Server ${state.serverId}: ${failureType}`
    );

  } finally {
    // Release the scheduler lease even if a health check fails.
    await ServerMonitoringState.updateOne(
      { _id: state._id },
      {
        $set: {
          schedulerLeaseUntil: null,
        },
      }
    );
  }
};



// ============================================================
// AUTOMATIC MONITORING SCHEDULER
// ============================================================

let monitoringCycleRunning = false;


// Execute one monitoring cycle.
const runMonitoringCycle = async () => {
  if (monitoringCycleRunning) {
    return;
  }

  monitoringCycleRunning = true;

  const config = getMonitoringConfig();
  const now = new Date();

  try {
    // Expire commands that were not completed in time.
    await RecoveryCommand.updateMany(
      {
        status: {
          $in: [
            "pending",
            "sent",
            "acknowledged",
            "executing",
          ],
        },
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: "expired",
          error: "Command expired before completion.",
        },
      }
    );

    // Find monitoring states that are due.
    const dueStates = await ServerMonitoringState.find({
      nextCheckAt: { $lte: now },

      $or: [
        { schedulerLeaseUntil: null },
        { schedulerLeaseUntil: { $exists: false } },
        { schedulerLeaseUntil: { $lte: now } },
      ],
    })
      .select("_id")
      .sort({ nextCheckAt: 1 })
      .limit(config.batchSize)
      .lean();

    const claimedStates = [];

    // Atomically claim each state.
    for (const item of dueStates) {
      const claimed = await ServerMonitoringState.findOneAndUpdate(
        {
          _id: item._id,
          nextCheckAt: { $lte: now },

          $or: [
            { schedulerLeaseUntil: null },
            { schedulerLeaseUntil: { $exists: false } },
            { schedulerLeaseUntil: { $lte: now } },
          ],
        },
        {
          $set: {
            schedulerLeaseUntil: new Date(
              now.getTime() + config.leaseMs
            ),

            nextCheckAt: new Date(
              now.getTime() + config.intervalMs
            ),
          },
        },
        {
          new: true,
        }
      );

      if (claimed) {
        claimedStates.push(claimed);
      }
    }

    // Process the claimed states concurrently.
    await Promise.allSettled(
      claimedStates.map((state) =>
        processMonitoringState(state)
      )
    );

  } catch (error) {
    console.error(
      "[SpareShare Monitor] Scheduler cycle failed:",
      error
    );

  } finally {
    monitoringCycleRunning = false;
  }
};


// Start the monitoring scheduler.
const startMonitoringScheduler = () => {
  if (
    process.env.MONITORING_SCHEDULER_ENABLED !== "true"
  ) {
    console.log(
      "[SpareShare Monitor] Scheduler is disabled."
    );

    return () => {};
  }

  const config = getMonitoringConfig();

  console.log(
    `[SpareShare Monitor] Scheduler started. Interval: ${config.intervalMs}ms`
  );

  // Run once immediately.
  runMonitoringCycle().catch((error) => {
    console.error(
      "[SpareShare Monitor] Initial cycle failed:",
      error
    );
  });

  const timer = setInterval(() => {
    runMonitoringCycle().catch((error) => {
      console.error(
        "[SpareShare Monitor] Cycle error:",
        error
      );
    });
  }, config.intervalMs);

  timer.unref();

  return () => {
    clearInterval(timer);

    console.log(
      "[SpareShare Monitor] Scheduler stopped."
    );
  };
};




module.exports = {
 createError,
  authenticateAgentToken,
  provisionAgentCredential,
  assertDeviceServerAssignment,
  validateQuickTunnelUrl,
  updateTunnelDestination,
  processHeartbeat,
  getDeviceConfiguration,
  getPendingCommands,
  createRecoveryCommand,
  reportCommandResult,

  // Automatic monitoring and recovery
  runMonitoringCycle,
  startMonitoringScheduler,
};
