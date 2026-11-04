
const mongoose = require("mongoose");
const crypto = require("crypto");

const Server = require("../models/server.model");
const ServerEndpoint = require("../models/serverEndpoint.model");
const MonitoringData = require("../models/monitoringData.model");

// Create consistent application errors
const createError = (message, statusCode, code) => {
  const e0rror = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

// Validate MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Handle database and validation errors
const handleEndpointError = (error, next) => {
  if (error.code === 11000) {
    return next(
      createError(
        "A server endpoint with this identifier already exists.",
        409,
        "SERVER_ENDPOINT_ALREADY_EXISTS"
      )
    );
  }

  if (error.name === "ValidationError") {
    return next(createError(error.message, 400, "VALIDATION_ERROR"));
  }

  next(error);
};

// Get authenticated user ID
const getUserId = (req) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError("Authentication is required.", 401, "UNAUTHORIZED");
  }
  if (!isValidObjectId(userId)) {
    throw createError("Invalid authenticated user ID.", 401, "INVALID_USER_ID");
  }
  return userId;
};

// Normalize a slug
const createSlug = (value) => {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
};

// Generate a permanent endpoint identifier
const generatePermanentId = (slug) => {
  const normalizedSlug = createSlug(slug) || "server";
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  return `${normalizedSlug}-${randomSuffix}`;
};

// Get the configured public endpoint base URL
const getPublicBaseUrl = () => {
  const baseUrl = process.env.SPARESHARE_PUBLIC_BASE_URL || "https://api.spareshare.in/s";
  return baseUrl.replace(/\/+$/, "");
};

// Generate the permanent link
const generatePermanentLink = (slug) => {
  const permanentId = generatePermanentId(slug);
  return `${getPublicBaseUrl()}/${permanentId}`;
};

// Validate a destination URL
const validateDestinationLink = (value, httpsOnly = true) => {
  if (typeof value !== "string" || !value.trim()) {
    throw createError("A valid destination link is required.", 400, "INVALID_DESTINATION_LINK");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw createError(
      "The destination link is not a valid URL.",
      400,
      "INVALID_DESTINATION_LINK"
    );
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw createError(
      "Only HTTP and HTTPS destination links are supported.",
      400,
      "INVALID_DESTINATION_PROTOCOL"
    );
  }

  if (httpsOnly && parsedUrl.protocol !== "https:") {
    throw createError(
      "HTTPS destination links are required.",
      400,
      "HTTPS_REQUIRED"
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw createError(
      "Destination URLs cannot contain embedded credentials.",
      400,
      "INVALID_DESTINATION_CREDENTIALS"
    );
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  const blockedHostnames = [
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
  ];

  if (
    blockedHostnames.includes(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw createError(
      "Local and internal destinations are not allowed.",
      400,
      "INVALID_DESTINATION_HOST"
    );
  }

  // Block private and loopback IPv4 literals
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  );

  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);

    if (octets.some((octet) => octet > 255)) {
      throw createError(
        "Invalid destination IP address.",
        400,
        "INVALID_DESTINATION_HOST"
      );
    }

    const [a, b] = octets;

    const isPrivateOrReserved =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224;

    if (isPrivateOrReserved) {
      throw createError(
        "Private, loopback, and reserved IP destinations are not allowed.",
        400,
        "INVALID_DESTINATION_HOST"
      );
    }
  }

  return parsedUrl.toString();
};

// Increment configuration version whenever routing settings change
const updateConfigVersion = (endpoint) => {
  endpoint.configVersion = (endpoint.configVersion || 1) + 1;
};

// Verify that the authenticated user owns the server
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

// Get an endpoint after verifying server ownership
const getOwnedEndpoint = async (userId, serverId) => {
  const server = await getOwnedServer(userId, serverId);

  const endpoint = await ServerEndpoint.findOne({
    serverId: server._id,
  });

  if (!endpoint) {
    throw createError(
      "Server endpoint not found.",
      404,
      "SERVER_ENDPOINT_NOT_FOUND"
    );
  }

  return { server, endpoint };
};

// Find an optional mapping by device ID and optional user ID
const findOptionalLinkIndex = (endpoint, deviceId, userId) => {
  const matchingIndexes = [];

  endpoint.optionalLinks.forEach((link, index) => {
    const deviceMatches =
      link.deviceId.toString() === deviceId;

    const userMatches =
      !userId || link.userId.toString() === userId;

    if (deviceMatches && userMatches) {
      matchingIndexes.push(index);
    }
  });

  if (matchingIndexes.length > 1) {
    throw createError(
      "Multiple mappings exist for this device. Provide the userId to identify the correct mapping.",
      400,
      "AMBIGUOUS_OPTIONAL_LINK"
    );
  }

  return matchingIndexes.length === 1
    ? matchingIndexes[0]
    : -1;
};


// CREATE SERVER ENDPOINT
const createServerEndpoint = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;
    const { redirectionLink, routingMode } = req.body;

    const server = await getOwnedServer(userId, serverId);

    const existingEndpoint = await ServerEndpoint.exists({
      serverId: server._id,
    });

    if (existingEndpoint) {
      throw createError(
        "An endpoint already exists for this server.",
        409,
        "SERVER_ENDPOINT_ALREADY_EXISTS"
      );
    }

    const normalizedRoutingMode = routingMode || "proxy";

    if (!["redirect", "proxy"].includes(normalizedRoutingMode)) {
      throw createError(
        "Invalid routing mode.",
        400,
        "INVALID_ROUTING_MODE"
      );
    }

    const normalizedDestination = validateDestinationLink(
      redirectionLink,
      true
    );

    const permanentLink = generatePermanentLink(
      server.slug || server.name
    );

    const endpoint = await ServerEndpoint.create({
      serverId: server._id,
      permanentLink,
      redirectionLink: normalizedDestination,
      optionalLinks: [],
      isActive: true,
      configVersion: 1,
      routingMode: normalizedRoutingMode,
    });

    return res.status(201).json({
      success: true,
      message: "Server endpoint created successfully.",
      data: {
        endpoint,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// GET SERVER ENDPOINT BY SERVER ID
const getServerEndpoint = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    return res.status(200).json({
      success: true,
      message: "Server endpoint fetched successfully.",
      data: {
        endpoint,
      },
    });
  } catch (error) {
    return next(error);
  }
};


// GET ALL SERVER ENDPOINTS OWNED BY USER
const getServerEndpoints = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const servers = await Server.find({
      owner: userId,
      isActive: true,
      status: { $ne: "deleted" },
    }).select("_id name slug status");

    const serverIds = servers.map((server) => server._id);

    const endpoints = await ServerEndpoint.find({
      serverId: { $in: serverIds },
    })
      .populate("serverId", "name slug status")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Server endpoints fetched successfully.",
      data: {
        endpoints,
      },
    });
  } catch (error) {
    return next(error);
  }
};


// ADD OPTIONAL LINK
const addOptionalLink = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    const {
      userId: mappedUserId,
      deviceId,
      destinationLink,
      priority,
    } = req.body;

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    if (!mappedUserId || !isValidObjectId(mappedUserId)) {
      throw createError(
        "A valid mapped user ID is required.",
        400,
        "INVALID_MAPPED_USER_ID"
      );
    }

    if (!deviceId || !isValidObjectId(deviceId)) {
      throw createError(
        "A valid device ID is required.",
        400,
        "INVALID_DEVICE_ID"
      );
    }

    if (
      priority !== undefined &&
      (
        !Number.isInteger(priority) ||
        priority < 1
      )
    ) {
      throw createError(
        "Priority must be a positive integer.",
        400,
        "INVALID_PRIORITY"
      );
    }

    const normalizedDestination = validateDestinationLink(
      destinationLink,
      endpoint.security?.httpsOnly !== false
    );

    const duplicate = endpoint.optionalLinks.some(
      (link) =>
        link.userId.toString() === mappedUserId &&
        link.deviceId.toString() === deviceId
    );

    if (duplicate) {
      throw createError(
        "An optional link already exists for this user and device.",
        409,
        "OPTIONAL_LINK_ALREADY_EXISTS"
      );
    }

    endpoint.optionalLinks.push({
      userId: mappedUserId,
      deviceId,
      destinationLink: normalizedDestination,
      priority: priority ?? 1,
      isActive: true,
    });

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(201).json({
      success: true,
      message: "Optional link added successfully.",
      data: {
        optionalLinks: endpoint.optionalLinks,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// UPDATE OPTIONAL LINK
const updateOptionalLink = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId, deviceId } = req.params;
    const { userId: mappedUserId } = req.query;

    if (!isValidObjectId(deviceId)) {
      throw createError(
        "Invalid device ID.",
        400,
        "INVALID_DEVICE_ID"
      );
    }

    if (mappedUserId && !isValidObjectId(mappedUserId)) {
      throw createError(
        "Invalid mapped user ID.",
        400,
        "INVALID_MAPPED_USER_ID"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    const linkIndex = findOptionalLinkIndex(
      endpoint,
      deviceId,
      mappedUserId
    );

    if (linkIndex === -1) {
      throw createError(
        "Optional link not found.",
        404,
        "OPTIONAL_LINK_NOT_FOUND"
      );
    }

    const updates = req.body;
    const allowedFields = [
      "destinationLink",
      "priority",
      "isActive",
    ];

    const updateFields = Object.keys(updates).filter(
      (field) => allowedFields.includes(field)
    );

    if (updateFields.length === 0) {
      throw createError(
        "No valid optional link fields provided.",
        400,
        "NO_VALID_UPDATE_FIELDS"
      );
    }

    const link = endpoint.optionalLinks[linkIndex];

    if (updates.destinationLink !== undefined) {
      link.destinationLink = validateDestinationLink(
        updates.destinationLink,
        endpoint.security?.httpsOnly !== false
      );
    }

    if (updates.priority !== undefined) {
      if (
        !Number.isInteger(updates.priority) ||
        updates.priority < 1
      ) {
        throw createError(
          "Priority must be a positive integer.",
          400,
          "INVALID_PRIORITY"
        );
      }

      link.priority = updates.priority;
    }

    if (updates.isActive !== undefined) {
      if (typeof updates.isActive !== "boolean") {
        throw createError(
          "isActive must be a boolean.",
          400,
          "INVALID_OPTIONAL_LINK_STATUS"
        );
      }

      link.isActive = updates.isActive;
    }

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Optional link updated successfully.",
      data: {
        optionalLink: endpoint.optionalLinks[linkIndex],
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// REMOVE OPTIONAL LINK
const removeOptionalLink = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId, deviceId } = req.params;
    const { userId: mappedUserId } = req.query;

    if (!isValidObjectId(deviceId)) {
      throw createError(
        "Invalid device ID.",
        400,
        "INVALID_DEVICE_ID"
      );
    }

    if (mappedUserId && !isValidObjectId(mappedUserId)) {
      throw createError(
        "Invalid mapped user ID.",
        400,
        "INVALID_MAPPED_USER_ID"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    const linkIndex = findOptionalLinkIndex(
      endpoint,
      deviceId,
      mappedUserId
    );

    if (linkIndex === -1) {
      throw createError(
        "Optional link not found.",
        404,
        "OPTIONAL_LINK_NOT_FOUND"
      );
    }

    endpoint.optionalLinks.splice(linkIndex, 1);

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Optional link removed successfully.",
      data: {
        optionalLinks: endpoint.optionalLinks,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// UPDATE OPTIONAL LINK PRIORITY
const updateOptionalLinkPriority = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId, deviceId } = req.params;
    const { userId: mappedUserId } = req.query;
    const { priority } = req.body;

    if (!isValidObjectId(deviceId)) {
      throw createError(
        "Invalid device ID.",
        400,
        "INVALID_DEVICE_ID"
      );
    }

    if (mappedUserId && !isValidObjectId(mappedUserId)) {
      throw createError(
        "Invalid mapped user ID.",
        400,
        "INVALID_MAPPED_USER_ID"
      );
    }

    if (!Number.isInteger(priority) || priority < 1) {
      throw createError(
        "Priority must be a positive integer.",
        400,
        "INVALID_PRIORITY"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    const linkIndex = findOptionalLinkIndex(
      endpoint,
      deviceId,
      mappedUserId
    );

    if (linkIndex === -1) {
      throw createError(
        "Optional link not found.",
        404,
        "OPTIONAL_LINK_NOT_FOUND"
      );
    }

    endpoint.optionalLinks[linkIndex].priority = priority;

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Optional link priority updated successfully.",
      data: {
        optionalLink: endpoint.optionalLinks[linkIndex],
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// UPDATE PRIMARY REDIRECTION LINK
const updateRedirectionLink = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;
    const { redirectionLink } = req.body;

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    endpoint.redirectionLink = validateDestinationLink(
      redirectionLink,
      endpoint.security?.httpsOnly !== false
    );

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Primary redirection link updated successfully.",
      data: {
        redirectionLink: endpoint.redirectionLink,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// UPDATE ROUTING MODE
const updateRoutingMode = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;
    const { routingMode } = req.body;

    if (!["redirect", "proxy"].includes(routingMode)) {
      throw createError(
        "Routing mode must be either redirect or proxy.",
        400,
        "INVALID_ROUTING_MODE"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    endpoint.routingMode = routingMode;

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Routing mode updated successfully.",
      data: {
        routingMode: endpoint.routingMode,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// UPDATE ENDPOINT SECURITY SETTINGS
const updateEndpointSecurity = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    const { enabled, httpsOnly, allowedMethods, rateLimitPerMinute } =
      req.body;

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    const updates = {
      enabled,
      httpsOnly,
      allowedMethods,
      rateLimitPerMinute,
    };

    const providedFields = Object.keys(updates).filter(
      (field) => updates[field] !== undefined
    );

    if (providedFields.length === 0) {
      throw createError(
        "No security settings provided.",
        400,
        "NO_SECURITY_SETTINGS"
      );
    }

    if (
      enabled !== undefined &&
      typeof enabled !== "boolean"
    ) {
      throw createError(
        "Security enabled must be a boolean.",
        400,
        "INVALID_SECURITY_SETTING"
      );
    }

    if (
      httpsOnly !== undefined &&
      typeof httpsOnly !== "boolean"
    ) {
      throw createError(
        "httpsOnly must be a boolean.",
        400,
        "INVALID_SECURITY_SETTING"
      );
    }

    if (allowedMethods !== undefined) {
      const validMethods = [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ];

      if (
        !Array.isArray(allowedMethods) ||
        allowedMethods.length === 0 ||
        allowedMethods.some(
          (method) =>
            typeof method !== "string" ||
            !validMethods.includes(method.toUpperCase())
        )
      ) {
        throw createError(
          "One or more allowed HTTP methods are invalid.",
          400,
          "INVALID_ALLOWED_METHODS"
        );
      }

      endpoint.security.allowedMethods = [
        ...new Set(
          allowedMethods.map((method) => method.toUpperCase())
        ),
      ];
    }

    if (enabled !== undefined) {
      endpoint.security.enabled = enabled;
    }

    if (httpsOnly !== undefined) {
      endpoint.security.httpsOnly = httpsOnly;
    }

    if (rateLimitPerMinute !== undefined) {
      if (
        !Number.isInteger(rateLimitPerMinute) ||
        rateLimitPerMinute < 1
      ) {
        throw createError(
          "Rate limit must be a positive integer.",
          400,
          "INVALID_RATE_LIMIT"
        );
      }

      endpoint.security.rateLimitPerMinute =
        rateLimitPerMinute;
    }

    // Revalidate existing destinations if HTTPS becomes mandatory
    if (endpoint.security.httpsOnly) {
      endpoint.redirectionLink = validateDestinationLink(
        endpoint.redirectionLink,
        true
      );

      for (const link of endpoint.optionalLinks) {
        link.destinationLink = validateDestinationLink(
          link.destinationLink,
          true
        );
      }
    }

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Endpoint security settings updated successfully.",
      data: {
        security: endpoint.security,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// ACTIVATE OR DEACTIVATE SERVER ENDPOINT
const updateEndpointStatus = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      throw createError(
        "isActive must be a boolean.",
        400,
        "INVALID_ENDPOINT_STATUS"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    endpoint.isActive = isActive;

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: isActive
        ? "Server endpoint activated successfully."
        : "Server endpoint deactivated successfully.",
      data: {
        isActive: endpoint.isActive,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};


// DELETE SERVER ENDPOINT
const deleteServerEndpoint = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    await ServerEndpoint.deleteOne({
      _id: endpoint._id,
      serverId,
    });

    return res.status(200).json({
      success: true,
      message: "Server endpoint deleted successfully.",
      data: {
        serverId,
        permanentLink: endpoint.permanentLink,
      },
    });
  } catch (error) {
    return next(error);
  }
};


// PUBLIC TRAFFIC HANDLER
const redirectTraffic = async (req, res, next) => {
  try {
    const { permanentId } = req.params;

    if (
      typeof permanentId !== "string" ||
      !/^[a-z0-9-]+$/.test(permanentId)
    ) {
      throw createError(
        "Invalid permanent endpoint identifier.",
        400,
        "INVALID_PERMANENT_ID"
      );
    }

    const permanentLink =
      `${getPublicBaseUrl()}/${permanentId}`;

    const endpoint = await ServerEndpoint.findOne({
      permanentLink,
      isActive: true,
    });

    if (!endpoint) {
      throw createError(
        "Server endpoint not found or inactive.",
        404,
        "SERVER_ENDPOINT_NOT_FOUND"
      );
    }

    const server = await Server.findOne({
      _id: endpoint.serverId,
      isActive: true,
      status: { $nin: ["deleted", "failed"] },
    }).select("_id status");

    if (!server) {
      throw createError(
        "The hosted server is unavailable.",
        503,
        "SERVER_UNAVAILABLE"
      );
    }

    // Check server-level monitoring information
    const monitoringData = await MonitoringData.findOne({
      serverId: endpoint.serverId,
    }).select("health lastHeartbeatAt");

    if (monitoringData?.health === "down") {
      throw createError(
        "The hosted server is currently down.",
        503,
        "SERVER_HEALTH_DOWN"
      );
    }

    // Check whether the HTTP method is allowed
    if (
      endpoint.security?.enabled &&
      !endpoint.security.allowedMethods.includes(req.method)
    ) {
      throw createError(
        "This HTTP method is not allowed.",
        405,
        "HTTP_METHOD_NOT_ALLOWED"
      );
    }

    // Proxy mode must be handled by the dedicated gateway
    if (endpoint.routingMode === "proxy") {
      throw createError(
        "Reverse proxy routing is not handled by this Express endpoint. Configure the public gateway to process proxy-mode endpoints.",
        501,
        "PROXY_ROUTING_NOT_IMPLEMENTED"
      );
    }

    // Redirect mode: use the primary destination
    const destination = validateDestinationLink(
      endpoint.redirectionLink,
      endpoint.security?.enabled &&
        endpoint.security?.httpsOnly !== false
    );

    const targetUrl = new URL(destination);
    const incomingUrl = new URL(
      req.originalUrl,
      "http://localhost"
    );

    const prefix = `/s/${permanentId}`;
    const remainingPath = incomingUrl.pathname.startsWith(prefix)
      ? incomingUrl.pathname.slice(prefix.length)
      : "";

    if (remainingPath) {
      targetUrl.pathname =
        `${targetUrl.pathname.replace(/\/+$/, "")}/` +
        remainingPath.replace(/^\/+/, "");
    }

    // Preserve the incoming query string
    incomingUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    // 307 preserves the original HTTP method and request body.
    // 302 is sufficient for ordinary GET and HEAD requests.
    const statusCode =
      ["GET", "HEAD"].includes(req.method) ? 302 : 307;

    res.set("Cache-Control", "no-store");

    return res.redirect(statusCode, targetUrl.toString());
  } catch (error) {
    return next(error);
  }
};


module.exports = {
  createServerEndpoint,
  getServerEndpoint,
  getServerEndpoints,

  addOptionalLink,
  updateOptionalLink,
  removeOptionalLink,
  updateOptionalLinkPriority,

  updateRedirectionLink,
  updateRoutingMode,
  updateEndpointSecurity,
  updateEndpointStatus,

  deleteServerEndpoint,

  redirectTraffic,
};
