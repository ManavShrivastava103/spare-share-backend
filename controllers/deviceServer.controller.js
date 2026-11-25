
const mongoose = require("mongoose");

const DeviceServer = require("../models/deviceServer.model");
const Device = require("../models/device.model");
const Server = require("../models/server.model");

const MIN_PORT = 3000;
const MAX_PORT = 65535;
const MAX_PORT_ALLOCATION_ATTEMPTS = 5;


// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Create consistent application errors.
const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};


// Validate MongoDB ObjectId.
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};


// Get authenticated user ID.
const getUserId = (req) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw createError(
      "Authentication is required.",
      401,
      "UNAUTHORIZED"
    );
  }

  if (!isValidObjectId(userId)) {
    throw createError(
      "Invalid authenticated user ID.",
      401,
      "INVALID_USER_ID"
    );
  }

  return userId;
};


// Handle database and validation errors.
const handleDeviceServerError = (error, next) => {
  if (error.code === 11000) {
    if (error.keyPattern?.onPort) {
      return next(
        createError(
          "Port allocation conflict. Please retry the request.",
          409,
          "DEVICE_PORT_CONFLICT"
        )
      );
    }

    return next(
      createError(
        "This server is already assigned to this device.",
        409,
        "DEVICE_SERVER_ALREADY_EXISTS"
      )
    );
  }

  if (error.name === "ValidationError") {
    return next(
      createError(
        error.message,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  return next(error);
};


// Verify that the device belongs to the authenticated user.
const getOwnedDevice = async (userId, deviceId) => {
  if (!isValidObjectId(deviceId)) {
    throw createError(
      "Invalid device ID.",
      400,
      "INVALID_DEVICE_ID"
    );
  }

  const device = await Device.findOne({
    _id: deviceId,
    userId,
    status: { $ne: "disabled" },
  });

  if (!device) {
    throw createError(
      "Device not found or you do not have permission to manage it.",
      404,
      "DEVICE_NOT_FOUND"
    );
  }

  return device;
};


// Verify that the server belongs to the authenticated user.
const getOwnedServer = async (userId, serverId) => {
  if (!isValidObjectId(serverId)) {
    throw createError(
      "Invalid server ID.",
      400,
      "INVALID_SERVER_ID"
    );
  }

  const server = await Server.findOne({
    _id: serverId,
    owner: userId,
    isActive: true,
    status: { $ne: "deleted" },
  });

  if (!server) {
    throw createError(
      "Server not found or you do not have permission to manage it.",
      404,
      "SERVER_NOT_FOUND"
    );
  }

  return server;
};


// Verify ownership of an existing DeviceServer assignment.
const getOwnedAssignment = async (userId, assignmentId) => {
  if (!isValidObjectId(assignmentId)) {
    throw createError(
      "Invalid assignment ID.",
      400,
      "INVALID_ASSIGNMENT_ID"
    );
  }

  const assignment = await DeviceServer.findById(assignmentId);

  if (!assignment) {
    throw createError(
      "Device server assignment not found.",
      404,
      "DEVICE_SERVER_NOT_FOUND"
    );
  }

  await Promise.all([
    getOwnedDevice(userId, assignment.deviceId),
    getOwnedServer(userId, assignment.serverId),
  ]);

  return assignment;
};


// ============================================================
// AUTOMATIC PORT ALLOCATION
// ============================================================

// Find the smallest unused port for a particular device.
//
// IMPORTANT:
// No status filter is applied.
// Even removed assignments reserve their previously assigned ports.
const findAvailablePort = async (deviceId) => {
  const assignments = await DeviceServer.find({
    deviceId,
  })
    .select("onPort")
    .sort({ onPort: 1 })
    .lean();

  let nextPort = MIN_PORT;

  for (const assignment of assignments) {
    const currentPort = assignment.onPort;

    if (currentPort < nextPort) {
      continue;
    }

    if (currentPort === nextPort) {
      nextPort++;
      continue;
    }

    if (currentPort > nextPort) {
      break;
    }
  }

  if (nextPort > MAX_PORT) {
    throw createError(
      "No available ports remain on this device.",
      409,
      "DEVICE_PORT_RANGE_EXHAUSTED"
    );
  }

  return nextPort;
};


// ============================================================
// CREATE DEVICE SERVER ASSIGNMENT
// ============================================================

// Required request body:
// {
//   "deviceId": "DEVICE_OBJECT_ID",
//   "serverId": "SERVER_OBJECT_ID"
// }
//
// onPort is automatically assigned.
const createDeviceServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const { deviceId, serverId } = req.body || {};

    if (!deviceId || !serverId) {
      throw createError(
        "Device ID and server ID are required.",
        400,
        "REQUIRED_FIELDS_MISSING"
      );
    }

    // Verify device and server ownership.
    const [device, server] = await Promise.all([
      getOwnedDevice(userId, deviceId),
      getOwnedServer(userId, serverId),
    ]);

    // Check whether this exact assignment already exists.
    const existingAssignment = await DeviceServer.findOne({
      deviceId: device._id,
      serverId: server._id,
    });

    if (existingAssignment) {
      throw createError(
        "This server is already assigned to this device.",
        409,
        "DEVICE_SERVER_ALREADY_EXISTS"
      );
    }

    // Retry if concurrent requests attempt to allocate
    // the same port on the same device.
    for (
      let attempt = 1;
      attempt <= MAX_PORT_ALLOCATION_ATTEMPTS;
      attempt++
    ) {
      const onPort = await findAvailablePort(device._id);

      try {
        const assignment = await DeviceServer.create({
          deviceId: device._id,
          serverId: server._id,
          onPort,
          status: "assigned",
        });

        return res.status(201).json({
          success: true,
          message: "Server successfully assigned to device.",
          data: {
            assignment,
          },
        });

      } catch (error) {
        if (error.code === 11000) {
          // A duplicate device-server pair must not be retried.
          if (!error.keyPattern?.onPort) {
            throw error;
          }

          // Another request acquired this port.
          if (attempt < MAX_PORT_ALLOCATION_ATTEMPTS) {
            continue;
          }
        }

        throw error;
      }
    }

    throw createError(
      "Unable to allocate a port. Please retry.",
      409,
      "PORT_ALLOCATION_FAILED"
    );

  } catch (error) {
    return handleDeviceServerError(error, next);
  }
};


// ============================================================
// GET ALL DEVICE SERVER ASSIGNMENTS
// ============================================================

// Optional query parameters:
// ?deviceId=...
// ?serverId=...
//
// Without filters, returns all assignments belonging to
// the authenticated user's devices and servers.
const getDeviceServers = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const { deviceId, serverId } = req.query;

    const query = {};

    if (deviceId) {
      const device = await getOwnedDevice(userId, deviceId);
      query.deviceId = device._id;
    } else {
      const devices = await Device.find({
        userId,
      }).select("_id").lean();

      query.deviceId = {
        $in: devices.map((device) => device._id),
      };
    }

    if (serverId) {
      const server = await getOwnedServer(userId, serverId);
      query.serverId = server._id;
    } else {
      const servers = await Server.find({
        owner: userId,
        isActive: true,
        status: { $ne: "deleted" },
      }).select("_id").lean();

      query.serverId = {
        $in: servers.map((server) => server._id),
      };
    }

    const assignments = await DeviceServer.find(query)
      .populate("deviceId")
      .populate("serverId")
      .sort({
        createdAt: -1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Device server assignments fetched successfully.",
      count: assignments.length,
      data: {
        assignments,
      },
    });

  } catch (error) {
    return next(error);
  }
};


// ============================================================
// GET SINGLE DEVICE SERVER ASSIGNMENT
// ============================================================

const getDeviceServerById = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const { assignmentId } = req.params;

    const assignment = await getOwnedAssignment(
      userId,
      assignmentId
    );

    await assignment.populate([
      {
        path: "deviceId",
      },
      {
        path: "serverId",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Device server assignment fetched successfully.",
      data: {
        assignment,
      },
    });

  } catch (error) {
    return next(error);
  }
};


// ============================================================
// UPDATE DEVICE SERVER ASSIGNMENT
// ============================================================

// Allowed fields:
// status
// priority
//
// onPort, deviceId and serverId cannot be changed here.
const updateDeviceServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const { assignmentId } = req.params;

    const {
      status,
      priority,
    } = req.body || {};

    const assignment = await getOwnedAssignment(
      userId,
      assignmentId
    );

    const updates = {};

    if (status !== undefined) {
      const validStatuses = [
        "assigned",
        "starting",
        "running",
        "stopped",
        "failed",
        "removed",
      ];

      if (!validStatuses.includes(status)) {
        throw createError(
          "Invalid assignment status.",
          400,
          "INVALID_DEVICE_SERVER_STATUS"
        );
      }

      updates.status = status;

      if (status === "running") {
        updates.lastStartedAt = new Date();
      }
    }

    if (priority !== undefined) {
      if (
        !Number.isInteger(priority) ||
        priority < 0
      ) {
        throw createError(
          "Priority must be a non-negative integer.",
          400,
          "INVALID_PRIORITY"
        );
      }

      updates.priority = priority;
    }

    if (Object.keys(updates).length === 0) {
      throw createError(
        "No valid fields provided for update.",
        400,
        "NO_VALID_UPDATE_FIELDS"
      );
    }

    Object.assign(assignment, updates);

    await assignment.save();

    return res.status(200).json({
      success: true,
      message: "Device server assignment updated successfully.",
      data: {
        assignment,
      },
    });

  } catch (error) {
    return handleDeviceServerError(error, next);
  }
};


// ============================================================
// DELETE DEVICE SERVER ASSIGNMENT
// ============================================================

// Soft delete:
// The document remains in MongoDB.
// Its port remains reserved permanently.
const deleteDeviceServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const { assignmentId } = req.params;

    const assignment = await getOwnedAssignment(
      userId,
      assignmentId
    );

    if (assignment.status === "removed") {
      throw createError(
        "This assignment has already been removed.",
        409,
        "DEVICE_SERVER_ALREADY_REMOVED"
      );
    }

    assignment.status = "removed";

    await assignment.save();

    return res.status(200).json({
      success: true,
      message: "Device server assignment removed successfully. Its port remains reserved.",
      data: {
        assignment,
      },
    });

  } catch (error) {
    return next(error);
  }
};


module.exports = {
  createDeviceServer,
  getDeviceServers,
  getDeviceServerById,
  updateDeviceServer,
  deleteDeviceServer,
};
