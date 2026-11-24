const {
  getEnvironmentForAgent,
} = require("../services/serverEnvironment.service");

const {
  createError,
  provisionAgentCredential,
  processHeartbeat,
  getDeviceConfiguration,
  getPendingCommands,
  updateTunnelDestination,
  createRecoveryCommand,
  reportCommandResult,
} = require("../services/hosting.service");


const provisionDeviceAgent = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const { deviceId } = req.params;

    if (!userId) {
      throw createError(
        "User authentication is required.",
        401,
        "AUTHENTICATION_REQUIRED"
      );
    }

    const credential = await provisionAgentCredential({
      deviceId,
      userId,
    });

    return res.status(201).json({
      success: true,
      message: "Device agent credential generated. Store it securely; it will not be returned again.",
      data: credential,
    });
  } catch (error) {
    next(error);
  }
};


const heartbeat = async (req, res, next) => {
  try {
    const result = await processHeartbeat({
      device: req.agent.device,
      payload: req.body || {},
    });

    return res.status(200).json({
      success: true,
      message: "Heartbeat received.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};


const getConfiguration = async (req, res, next) => {
  try {
    const servers = await getDeviceConfiguration(
      req.agent.device
    );

    return res.status(200).json({
      success: true,
      data: {
        deviceId: req.agent.device._id,
        agentVersion: req.agent.device.agentVersion || null,
        heartbeatIntervalSeconds: 30,
        commandPollingIntervalSeconds: 10,
        servers,
      },
    });
  } catch (error) {
    next(error);
  }
};


const pollCommands = async (req, res, next) => {
  try {
    const commands = await getPendingCommands(
      req.agent.device
    );

    return res.status(200).json({
      success: true,
      count: commands.length,
      commands,
    });
  } catch (error) {
    next(error);
  }
};


const updateTunnel = async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const { tunnelUrl } = req.body || {};

    const result = await updateTunnelDestination({
      device: req.agent.device,
      serverId,
      tunnelUrl,
    });

    return res.status(200).json({
      success: true,
      message: "Tunnel destination updated successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};


const queueCommand = async (req, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw createError(
        "User authentication is required.",
        401,
        "AUTHENTICATION_REQUIRED"
      );
    }

    const {
      serverId,
      deviceId,
      action,
      payload,
    } = req.body || {};

    const command = await createRecoveryCommand({
      userId,
      serverId,
      deviceId,
      action,
      payload,
    });

    return res.status(201).json({
      success: true,
      message: "Recovery command queued.",
      data: {
        commandId: command.commandId,
        serverId: command.serverId,
        deviceId: command.deviceId,
        action: command.action,
        status: command.status,
        expiresAt: command.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
};


const commandResult = async (req, res, next) => {
  try {
    const {
      status,
      result,
      error,
    } = req.body || {};

    const command = await reportCommandResult({
      device: req.agent.device,
      commandId: req.params.commandId,
      status,
      result,
      error,
    });

    return res.status(200).json({
      success: true,
      message: "Command result recorded.",
      data: {
        commandId: command.commandId,
        status: command.status,
        completedAt: command.completedAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
};


// Fetch decrypted environment configuration for an assigned server.
const getServerEnvironment = async (req, res, next) => {
  try {
    const { serverId } = req.params;

    const result = await getEnvironmentForAgent({
      device: req.agent.device,
      serverId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error) {
    next(error);
  }
};


module.exports = {
  provisionDeviceAgent,
  heartbeat,
  getConfiguration,
  pollCommands,
  updateTunnel,
  queueCommand,
  commandResult,
  getServerEnvironment,
};
