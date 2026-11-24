const mongoose = require("mongoose");
const Server = require("../models/server.model");
const MonitoringData = require("../models/monitoringData.model");

// Helper: create consistent application errors
const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

// Helper: validate MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: convert duplicate key errors into application errors
const handleServerError = (error, next) => {
  if (error.code === 11000) {
    return next(
      createError(
        "A server with this slug already exists.",
        409,
        "SERVER_SLUG_ALREADY_EXISTS"
      )
    );
  }

  if (error.name === "ValidationError") {
    return next(
      createError(error.message, 400, "VALIDATION_ERROR")
    );
  }

  next(error);
};

// Helper: ensure authenticated user exists
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

// Helper: normalize slug
const createSlug = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

// Helper: check slug availability for a particular user
const isSlugAvailable = async (
  ownerId,
  slug,
  excludeServerId = null
) => {
  const normalizedSlug = createSlug(slug);

  if (!normalizedSlug) {
    throw createError(
      "Invalid server slug.",
      400,
      "INVALID_SERVER_SLUG"
    );
  }

  const query = {
    owner: ownerId,
    slug: normalizedSlug,
  };

  // Exclude current server during updates
  if (excludeServerId) {
    query._id = { $ne: excludeServerId };
  }

  const existingServer = await Server.exists(query);

  return {
    available: !existingServer,
    slug: normalizedSlug,
  };
};

// Fields clients are allowed to modify
const allowedUpdateFields = [
  "name",
  "slug",
  "description",
  "visibility",
  "port",
  "environmentVersionId",
  "resources",
  "collaborators",
  "repository",
];


// CREATE SERVER
const createServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const {
      name,
      slug,
      description,
      visibility,
      port,
      environmentVersionId,
      uploadType,
      repository,
      resources,
      collaborators,
      monitoringEnabled,
    } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      throw createError(
        "Server name is required.",
        400,
        "SERVER_NAME_REQUIRED"
      );
    }

    const normalizedSlug = createSlug(
      typeof slug === "string" && slug.trim()
        ? slug
        : name
    );

    if (!normalizedSlug) {
      throw createError(
        "A valid server slug could not be generated.",
        400,
        "INVALID_SERVER_SLUG"
      );
    }

    // Check slug availability before insertion
    const slugCheck = await isSlugAvailable(userId, normalizedSlug);

    if (!slugCheck.available) {
      throw createError(
        "You already have a server with this slug.",
        409,
        "SERVER_SLUG_ALREADY_EXISTS"
      );
    }

    if (collaborators !== undefined && !Array.isArray(collaborators)) {
      throw createError(
        "Collaborators must be an array of user IDs.",
        400,
        "INVALID_COLLABORATORS"
      );
    }

    const collaboratorIds = collaborators ?? [];

    for (const id of collaboratorIds) {
      if (!isValidObjectId(id)) {
        throw createError(
          "One or more collaborator IDs are invalid.",
          400,
          "INVALID_COLLABORATOR_ID"
        );
      }
    }

    if (
      environmentVersionId !== undefined &&
      !isValidObjectId(environmentVersionId)
    ) {
      throw createError(
        "Invalid environment version ID.",
        400,
        "INVALID_ENVIRONMENT_VERSION_ID"
      );
    }

    const server = await Server.create({
      owner: userId,
      name: name.trim(),
      slug: slugCheck.slug,
      description,
      visibility,
      port,
      environmentVersionId,
      uploadType,
      repository,
      resources,
      collaborators: [
        ...new Set([
          userId.toString(),
          ...collaboratorIds.map(String),
        ]),
      ],
      monitoringEnabled: monitoringEnabled ?? false,
    });

    return res.status(201).json({
      success: true,
      message: "Server created successfully.",
      data: { server },
    });
  } catch (error) {
    return handleServerError(error, next);
  }
};


// GET ALL SERVERS OWNED BY OR SHARED WITH THE LOGGED-IN USER
const getServers = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const servers = await Server.find({
      $or: [
        { owner: userId },
        { collaborators: userId },
      ],
      isActive: true,
      status: { $ne: "deleted" },
    })
      .sort({ createdAt: -1 })
      .populate(
        "environmentVersionId",
        "name version type"
      )
      .lean();

    return res.status(200).json({
      success: true,
      message: "Servers fetched successfully.",
      data: { servers },
    });
  } catch (error) {
    return next(error);
  }
};


// GET A SINGLE SERVER
const getServerById = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

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
    }).populate(
      "environmentVersionId",
      "name version language"
    );

    if (!server) {
      throw createError(
        "Server not found.",
        404,
        "SERVER_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Server fetched successfully.",
      data: { server },
    });
  } catch (error) {
    return next(error);
  }
};


// UPDATE SERVER DETAILS
const updateServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    if (!isValidObjectId(serverId)) {
      throw createError(
        "Invalid server ID.",
        400,
        "INVALID_SERVER_ID"
      );
    }

    const updates = {};

    for (const field of allowedUpdateFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw createError(
        "No valid fields provided for update.",
        400,
        "NO_VALID_UPDATE_FIELDS"
      );
    }

    if (
      updates.name !== undefined &&
      (
        typeof updates.name !== "string" ||
        !updates.name.trim()
      )
    ) {
      throw createError(
        "Server name cannot be empty.",
        400,
        "INVALID_SERVER_NAME"
      );
    }

    if (updates.name !== undefined) {
      updates.name = updates.name.trim();
    }

    // Check slug availability during update
    if (updates.slug !== undefined) {
      if (
        typeof updates.slug !== "string" ||
        !updates.slug.trim()
      ) {
        throw createError(
          "Server slug cannot be empty.",
          400,
          "INVALID_SERVER_SLUG"
        );
      }

      updates.slug = createSlug(updates.slug);

      if (!updates.slug) {
        throw createError(
          "Invalid server slug.",
          400,
          "INVALID_SERVER_SLUG"
        );
      }

      const slugCheck = await isSlugAvailable(
        userId,
        updates.slug,
        serverId
      );

      if (!slugCheck.available) {
        throw createError(
          "You already have a server with this slug.",
          409,
          "SERVER_SLUG_ALREADY_EXISTS"
        );
      }

      updates.slug = slugCheck.slug;
    }

    if (
      updates.environmentVersionId !== undefined &&
      !isValidObjectId(updates.environmentVersionId)
    ) {
      throw createError(
        "Invalid environment version ID.",
        400,
        "INVALID_ENVIRONMENT_VERSION_ID"
      );
    }

    if (updates.collaborators !== undefined) {
      if (!Array.isArray(updates.collaborators)) {
        throw createError(
          "Collaborators must be an array of user IDs.",
          400,
          "INVALID_COLLABORATORS"
        );
      }

      for (const id of updates.collaborators) {
        if (!isValidObjectId(id)) {
          throw createError(
            "One or more collaborator IDs are invalid.",
            400,
            "INVALID_COLLABORATOR_ID"
          );
        }
      }

      updates.collaborators = [
        ...new Set([
          userId.toString(),
          ...updates.collaborators.map(String),
        ]),
      ];
    }

    const server = await Server.findOneAndUpdate(
      {
        _id: serverId,
        owner: userId,
        isActive: true,
        status: { $ne: "deleted" },
      },
      { $set: updates },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    );

    if (!server) {
      throw createError(
        "Server not found or you do not have permission to update it.",
        404,
        "SERVER_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Server updated successfully.",
      data: { server },
    });
  } catch (error) {
    return handleServerError(error, next);
  }
};


// CHECK SERVER SLUG AVAILABILITY
const checkSlugAvailability = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { slug, serverId } = req.query;

    if (typeof slug !== "string" || !slug.trim()) {
      throw createError(
        "Slug is required.",
        400,
        "SERVER_SLUG_REQUIRED"
      );
    }

    if (serverId && !isValidObjectId(serverId)) {
      throw createError(
        "Invalid server ID.",
        400,
        "INVALID_SERVER_ID"
      );
    }

    const result = await isSlugAvailable(
      userId,
      slug,
      serverId || null
    );

    return res.status(200).json({
      success: true,
      data: {
        slug: result.slug,
        available: result.available,
      },
    });
  } catch (error) {
    return next(error);
  }
};


// SOFT DELETE SERVER
const deleteServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    if (!isValidObjectId(serverId)) {
      throw createError(
        "Invalid server ID.",
        400,
        "INVALID_SERVER_ID"
      );
    }

    const server = await Server.findOneAndUpdate(
      {
        _id: serverId,
        owner: userId,
        isActive: true,
        status: { $ne: "deleted" },
      },
      {
        $set: {
          status: "deleted",
          isActive: false,
          stoppedAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!server) {
      throw createError(
        "Server not found or it has already been deleted.",
        404,
        "SERVER_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Server deleted successfully.",
      data: {
        serverId: server._id,
        status: server.status,
        isActive: server.isActive,
      },
    });
  } catch (error) {
    return handleServerError(error, next);
  }
};


// ENABLE / DISABLE SERVER MONITORING
const updateServerMonitoring = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;
    const { monitoringEnabled } = req.body;

    // Validate server ID
    if (!isValidObjectId(serverId)) {
      throw createError(
        "Invalid server ID.",
        400,
        "INVALID_SERVER_ID"
      );
    }

    // Validate monitoring status
    if (typeof monitoringEnabled !== "boolean") {
      throw createError(
        "monitoringEnabled must be a boolean.",
        400,
        "INVALID_MONITORING_STATUS"
      );
    }

    // Update monitoring status
    const server = await Server.findOneAndUpdate(
      {
        _id: serverId,
        owner: userId,
        isActive: true,
        status: { $ne: "deleted" },
      },
      {
        $set: {
          monitoringEnabled,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!server) {
      throw createError(
        "Server not found or you do not have permission to manage it.",
        404,
        "SERVER_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      message: monitoringEnabled
        ? "Server monitoring enabled successfully."
        : "Server monitoring disabled successfully.",
      data: {
        serverId: server._id,
        monitoringEnabled: server.monitoringEnabled,
      },
    });
  } catch (error) {
    return handleServerError(error, next);
  }
};


// UPDATE SERVER RESOURCE METRICS AND HEARTBEAT
const updateServerMetrics = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

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
    }).select("_id monitoringEnabled");

    if (!server) {
      throw createError(
        "Server not found or you do not have permission to update it.",
        404,
        "SERVER_NOT_FOUND"
      );
    }

    if (!server.monitoringEnabled) {
      throw createError(
        "Monitoring is disabled for this server.",
        403,
        "MONITORING_DISABLED"
      );
    }

    const {
      cpu,
      memory,
      storage,
      network,
      uptimeSeconds,
    } = req.body;

    const updates = {};

    // Validate numeric measurements.
    const validateMetric = (
      value,
      field,
      max = Infinity,
      min = 0
    ) => {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      ) {
        throw createError(
          `${field} must be a valid number between ${min} and ${max}.`,
          400,
          "INVALID_RESOURCE_METRIC"
        );
      }
    };

    // Validate and prepare resource groups.
    const processGroup = (group, fields, prefix) => {
      if (group === undefined) return;

      if (
        !group ||
        typeof group !== "object" ||
        Array.isArray(group)
      ) {
        throw createError(
          `${prefix} must be an object.`,
          400,
          "INVALID_RESOURCE_METRIC"
        );
      }

      for (const [field, rules] of Object.entries(fields)) {
        if (group[field] !== undefined) {
          const { max = Infinity, min = 0 } = rules;

          validateMetric(
            group[field],
            `${prefix}.${field}`,
            max,
            min
          );

          updates[`${prefix}.${field}`] = group[field];
        }
      }
    };

    // CPU metrics
    processGroup(
      cpu,
      {
        usagePercent: { max: 100 },
        totalCores: { min: 1 },
        loadAverage: {},
      },
      "cpu"
    );

    // Memory metrics
    // usagePercent is calculated by the backend.
    processGroup(
      memory,
      {
        usageMb: {},
        totalMb: {},
      },
      "memory"
    );

    // Storage metrics
    // usagePercent is calculated by the backend.
    processGroup(
      storage,
      {
        usedMb: {},
        totalMb: {},
      },
      "storage"
    );

    // Network metrics
    processGroup(
      network,
      {
        uploadBytes: {},
        downloadBytes: {},
        uploadBytesPerSecond: {},
        downloadBytesPerSecond: {},
      },
      "network"
    );

    // Uptime
    if (uptimeSeconds !== undefined) {
      validateMetric(uptimeSeconds, "uptimeSeconds");
      updates.uptimeSeconds = uptimeSeconds;
    }

    if (Object.keys(updates).length === 0) {
      throw createError(
        "No valid resource metrics were provided.",
        400,
        "NO_METRICS_PROVIDED"
      );
    }

    // Fetch existing metrics so partial updates can calculate
    // percentages using previously stored total values.
    const existingData = await MonitoringData.findOne({
      serverId: server._id,
    }).select("memory storage");

    const existingMemory = existingData?.memory || {};
    const existingStorage = existingData?.storage || {};

    // Calculate RAM usage percentage.
    const memoryUsageMb =
      updates["memory.usageMb"] ?? existingMemory.usageMb ?? 0;

    const memoryTotalMb =
      updates["memory.totalMb"] ?? existingMemory.totalMb ?? 0;

    if (memoryTotalMb > 0) {
      if (memoryUsageMb > memoryTotalMb) {
        throw createError(
          "Used memory cannot exceed total memory.",
          400,
          "INVALID_MEMORY_USAGE"
        );
      }

      if (
        updates["memory.usageMb"] !== undefined ||
        updates["memory.totalMb"] !== undefined
      ) {
        updates["memory.usagePercent"] =
          (memoryUsageMb / memoryTotalMb) * 100;
      }
    } else if (memoryUsageMb > 0) {
      throw createError(
        "Total memory must be greater than zero when memory is in use.",
        400,
        "INVALID_TOTAL_MEMORY"
      );
    }

    // Calculate storage usage percentage.
    const storageUsedMb =
      updates["storage.usedMb"] ?? existingStorage.usedMb ?? 0;

    const storageTotalMb =
      updates["storage.totalMb"] ?? existingStorage.totalMb ?? 0;

    if (storageTotalMb > 0) {
      if (storageUsedMb > storageTotalMb) {
        throw createError(
          "Used storage cannot exceed total storage.",
          400,
          "INVALID_STORAGE_USAGE"
        );
      }

      if (
        updates["storage.usedMb"] !== undefined ||
        updates["storage.totalMb"] !== undefined
      ) {
        updates["storage.usagePercent"] =
          (storageUsedMb / storageTotalMb) * 100;
      }
    } else if (storageUsedMb > 0) {
      throw createError(
        "Total storage must be greater than zero when storage is in use.",
        400,
        "INVALID_TOTAL_STORAGE"
      );
    }

    // Update heartbeat timestamp.
    updates.lastHeartbeatAt = new Date();

    const monitoringData = await MonitoringData.findOneAndUpdate(
      { serverId: server._id },
      {
        $set: updates,
        $setOnInsert: {
          serverId: server._id,
          health: "unknown",
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Server metrics updated successfully.",
      data: {
        serverId: server._id,
        cpu: monitoringData.cpu,
        memory: monitoringData.memory,
        storage: monitoringData.storage,
        network: monitoringData.network,
        uptimeSeconds: monitoringData.uptimeSeconds,
        lastHeartbeatAt: monitoringData.lastHeartbeatAt,
      },
    });
  } catch (error) {
    return handleServerError(error, next);
  }
};


module.exports = {
  createServer,
  getServers,
  getServerById,
  updateServer,
  deleteServer,
  checkSlugAvailability,
  updateServerMonitoring,
  updateServerMetrics,
};
