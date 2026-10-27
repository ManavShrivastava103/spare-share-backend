
const mongoose = require("mongoose");
const Server = require("../models/server.model");

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
  if (error.code === 11000) return next(createError("A server with this slug already exists.", 409, "SERVER_SLUG_ALREADY_EXISTS"));
  if (error.name === "ValidationError") return next(createError(error.message, 400, "VALIDATION_ERROR"));
  next(error);
};

// Helper: ensure authenticated user exists
const getUserId = (req) => {
  const userId = req.user?.userId;
  if (!userId) throw createError("Authentication is required.", 401, "UNAUTHORIZED");
  if (!isValidObjectId(userId)) throw createError("Invalid authenticated user ID.", 401, "INVALID_USER_ID");
  return userId;
};

// Helper: normalize slug
const createSlug = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);

// Fields clients are allowed to modify
const allowedUpdateFields = [
  "name", "slug", "description", "visibility", "port",
  "environmentVersionId", "resources", "collaborators",
];

// CREATE SERVER --> SAVE THE INFO TO THE CLOUD
const createServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { name, slug, description, visibility, port, environmentVersionId, uploadType, repository, resources, collaborators } = req.body;

    if (typeof name !== "string" || !name.trim()) throw createError("Server name is required.", 400, "SERVER_NAME_REQUIRED");

    const normalizedSlug = createSlug(typeof slug === "string" && slug.trim() ? slug : name);
    if (!normalizedSlug) throw createError("A valid server slug could not be generated.", 400, "INVALID_SERVER_SLUG");
    if (collaborators !== undefined && !Array.isArray(collaborators)) throw createError("Collaborators must be an array of user IDs.", 400, "INVALID_COLLABORATORS");

    const collaboratorIds = collaborators ?? [];

    for (const id of collaboratorIds) {
      if (!isValidObjectId(id)) throw createError("One or more collaborator IDs are invalid.", 400, "INVALID_COLLABORATOR_ID");
    }

    if (environmentVersionId !== undefined && !isValidObjectId(environmentVersionId)) {
      throw createError("Invalid environment version ID.", 400, "INVALID_ENVIRONMENT_VERSION_ID");
    }

    const server = await Server.create({
      owner: userId,
      name: name.trim(),
      slug: normalizedSlug,
      description,
      visibility,
      port,
      environmentVersionId,
      uploadType,
      repository,
      resources,
      collaborators: [...new Set([userId.toString(), ...collaboratorIds.map(String)])],
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
      $or: [{owner: userId}, {collaborators: userId},],
      isActive: true,
      status: { $ne: "deleted" },
    }).sort({ createdAt: -1 }).populate("environmentVersionId", "name version type").lean();

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

    if (!isValidObjectId(serverId)) throw createError("Invalid server ID.", 400, "INVALID_SERVER_ID");

    const server = await Server.findOne({
      _id: serverId,
      owner: userId,
      isActive: true,
      status: { $ne: "deleted" },
    }).populate("environmentVersionId", "name version language");

    if (!server) throw createError("Server not found.", 404, "SERVER_NOT_FOUND");

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

    if (!isValidObjectId(serverId)) throw createError("Invalid server ID.", 400, "INVALID_SERVER_ID");

    const updates = {};
    for (const field of allowedUpdateFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) {
      throw createError("No valid fields provided for update.", 400, "NO_VALID_UPDATE_FIELDS");
    }

    if (updates.name !== undefined && (typeof updates.name !== "string" || !updates.name.trim())) {
      throw createError("Server name cannot be empty.", 400, "INVALID_SERVER_NAME");
    }
    if (updates.name !== undefined) updates.name = updates.name.trim();
    if (updates.slug !== undefined) {
      if (typeof updates.slug !== "string" || !updates.slug.trim()) {
        throw createError("Server slug cannot be empty.", 400, "INVALID_SERVER_SLUG");
      }
      updates.slug = createSlug(updates.slug);
      if (!updates.slug) throw createError("Invalid server slug.", 400, "INVALID_SERVER_SLUG");
    }
    if (updates.environmentVersionId !== undefined && !isValidObjectId(updates.environmentVersionId)) {
      throw createError("Invalid environment version ID.", 400, "INVALID_ENVIRONMENT_VERSION_ID");
    }
    if (updates.collaborators !== undefined) {
      if (!Array.isArray(updates.collaborators)) {
        throw createError("Collaborators must be an array of user IDs.", 400, "INVALID_COLLABORATORS");
      }
      for (const id of updates.collaborators) {
        if (!isValidObjectId(id)) throw createError("One or more collaborator IDs are invalid.", 400, "INVALID_COLLABORATOR_ID");
      }
      updates.collaborators = [...new Set([userId.toString(), ...updates.collaborators.map(String)])];
    }

    const server = await Server.findOneAndUpdate(
      { _id: serverId, owner: userId, isActive: true, status: { $ne: "deleted" } },
      { $set: updates },
      { new: true, runValidators: true, context: "query" }
    );
    if (!server) {
      throw createError("Server not found or you do not have permission to update it.", 404, "SERVER_NOT_FOUND");
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

// SOFT DELETE SERVER
const deleteServer = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    if (!isValidObjectId(serverId)) throw createError("Invalid server ID.", 400, "INVALID_SERVER_ID");

    const server = await Server.findOneAndUpdate(
      { _id: serverId, owner: userId, isActive: true, status: { $ne: "deleted" } },
      { $set: { status: "deleted", isActive: false, stoppedAt: new Date() } },
      { new: true, runValidators: true }
    );

    if (!server) {
      throw createError("Server not found or it has already been deleted.", 404, "SERVER_NOT_FOUND");
    }

    return res.status(200).json({
      success: true,
      message: "Server deleted successfully.",
      data: { serverId: server._id, status: server.status, isActive: server.isActive },
    });
  } catch (error) {
    return handleServerError(error, next);
  }
};

module.exports = { createServer, getServers, getServerById, updateServer, deleteServer };
