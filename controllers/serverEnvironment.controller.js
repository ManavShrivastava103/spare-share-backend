const crypto = require("crypto");
const {
  createError,
  getServerEnvironment,
  updateServerEnvironment,
  deleteServerEnvironmentVariable,
  assertServerOwner,
} = require("../services/serverEnvironment.service");

const Device = require("../models/device.model");
const DeviceServer = require("../models/deviceServer.model");
const { RecoveryCommand } = require("../models/hostingRuntime.model");


// ============================================================
// GET ENVIRONMENT VARIABLES
// ============================================================

const getEnvironment = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const { serverId } = req.params;

    const result = await getServerEnvironment({
      serverId,
      userId,
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


// ============================================================
// CREATE OR UPDATE ENVIRONMENT VARIABLES
// ============================================================

const saveEnvironment = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const { serverId } = req.params;
    const { variables } = req.body || {};

    const result = await updateServerEnvironment({
      serverId,
      userId,
      variables,
    });

    return res.status(200).json({
      success: true,
      message: "Environment variables saved successfully.",
      data: result,
    });

  } catch (error) {
    next(error);
  }
};


// ============================================================
// DELETE ONE ENVIRONMENT VARIABLE
// ============================================================

const deleteEnvironmentVariable = async (
  req,
  res,
  next
) => {
  try {
    const userId = req.user?.userId;
    const { serverId, key } = req.params;

    const result = await deleteServerEnvironmentVariable({
      serverId,
      userId,
      key,
    });

    return res.status(200).json({
      success: true,
      message: "Environment variable deleted successfully.",
      data: result,
    });

  } catch (error) {
    next(error);
  }
};


// ============================================================
// QUEUE ENVIRONMENT SYNCHRONIZATION
// ============================================================

const syncEnvironment = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const { serverId } = req.params;

    await assertServerOwner({
      serverId,
      userId,
    });

    const environment = await require(
      "../models/serverEnvironment.model"
    ).findOne({ serverId });

    if (!environment) {
      throw createError(
        "No environment configuration exists for this server.",
        404,
        "ENVIRONMENT_NOT_FOUND"
      );
    }

    const assignments = await DeviceServer.find({
      serverId,
      status: { $ne: "removed" },
    }).lean();

    if (assignments.length === 0) {
      throw createError(
        "No hosting device is assigned to this server.",
        409,
        "NO_ASSIGNED_DEVICE"
      );
    }

    const commands = [];

    for (const assignment of assignments) {
      const device = await Device.findOne({
        _id: assignment.deviceId,
        userId,
        isActive: true,
      });

      if (!device) {
        continue;
      }

      const command = await RecoveryCommand.create({
        commandId: crypto.randomUUID(),
        serverId,
        deviceId: device._id,
        action: "SYNC_ENV",
        payload: {
          environmentRevision: environment.revision,
        },
        status: "pending",
        expiresAt: new Date(
          Date.now() + 10 * 60 * 1000
        ),
      });

      commands.push({
        deviceId: device._id,
        commandId: command.commandId,
      });
    }

    if (commands.length === 0) {
      throw createError(
        "No eligible assigned hosting devices were found.",
        409,
        "NO_ELIGIBLE_DEVICE"
      );
    }

    return res.status(202).json({
      success: true,
      message: "Environment synchronization queued.",
      data: {
        serverId,
        environmentRevision: environment.revision,
        queuedDevices: commands.length,
        commands,
      },
    });

  } catch (error) {
    next(error);
  }
};


module.exports = {
  getEnvironment,
  saveEnvironment,
  deleteEnvironmentVariable,
  syncEnvironment,
};
