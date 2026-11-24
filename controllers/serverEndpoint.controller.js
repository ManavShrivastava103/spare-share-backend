const mongoose = require("mongoose");
const crypto = require("crypto");
const httpProxy = require("http-proxy");
const net = require("net");

const Server = require("../models/server.model");
const ServerEndpoint = require("../models/serverEndpoint.model");
const MonitoringData = require("../models/monitoringData.model");

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
  secure: true,
  proxyTimeout: 30000,
  timeout: 30000,
  prependPath: false,
  cookieDomainRewrite: "",
});

// Create consistent application errors
const createError = (message, statusCode, code) => {
  const error = new Error(message);
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
    return next(
      createError(error.message, 400, "VALIDATION_ERROR")
    );
  }

  return next(error);
};

// Get authenticated user ID
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

// Normalize slug
const createSlug = (value) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
};

// Get public URL base
const getPublicBaseUrl = () => {
  const value = process.env.SPARESHARE_PUBLIC_BASE_URL;

  if (!value) {
    throw createError(
      "SPARESHARE_PUBLIC_BASE_URL is not configured.",
      500,
      "PUBLIC_BASE_URL_NOT_CONFIGURED"
    );
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createError(
      "SPARESHARE_PUBLIC_BASE_URL is invalid.",
      500,
      "INVALID_PUBLIC_BASE_URL"
    );
  }

  if (
    parsedUrl.protocol !== "https:" &&
    process.env.NODE_ENV === "production"
  ) {
    throw createError(
      "The public endpoint base URL must use HTTPS.",
      500,
      "PUBLIC_HTTPS_REQUIRED"
    );
  }

  return value.replace(/\/+$/, "");
};

// Generate permanent link
// const generatePermanentLink = (slug) => {
//   const normalizedSlug = createSlug(slug) || "server";
//   const suffix = crypto.randomBytes(5).toString("hex");

//   return `${getPublicBaseUrl()}/${normalizedSlug}-${suffix}`;
// };


// Generate a unique permanent endpoint URL
const generatePermanentLink = async (slug, maxAttempts = 10) => {
  const normalizedSlug = createSlug(slug) || "server";
  const baseUrl = getPublicBaseUrl();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Generate a cryptographically secure 80-bit random suffix
    const suffix = crypto.randomBytes(10).toString("hex");

    const permanentLink = `${baseUrl}/${normalizedSlug}-${suffix}`;

    // Check whether this permanent link already exists
    const existing = await ServerEndpoint.exists({
      permanentLink,
    });

    if (!existing) {
      return permanentLink;
    }
  }

  throw createError(
    "Unable to generate a unique permanent endpoint after multiple attempts.",
    503,
    "PERMANENT_LINK_GENERATION_FAILED"
  );
};


// Validate destination URL
const validateDestinationLink = (value, httpsOnly = true) => {
  if (typeof value !== "string" || !value.trim()) {
    throw createError(
      "A valid destination link is required.",
      400,
      "INVALID_DESTINATION_LINK"
    );
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
      "Only HTTP and HTTPS destinations are supported.",
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

  const hostname = parsedUrl.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  ) {
    throw createError(
      "Local and internal destinations are not allowed.",
      400,
      "INVALID_DESTINATION_HOST"
    );
  }

  // Reject private and reserved IPv4 destinations
  if (net.isIP(hostname) === 4) {
    const [a, b, c] = hostname.split(".").map(Number);

    const blocked =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0);

    if (blocked) {
      throw createError(
        "Private or reserved IP destinations are not allowed.",
        400,
        "INVALID_DESTINATION_HOST"
      );
    }
  }

  // Reject loopback, private and link-local IPv6 addresses
  if (net.isIP(hostname) === 6) {
    const normalized = hostname.toLowerCase();

    if (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      throw createError(
        "Private or reserved IPv6 destinations are not allowed.",
        400,
        "INVALID_DESTINATION_HOST"
      );
    }
  }

  return parsedUrl.toString();
};

// Increment routing configuration version
const updateConfigVersion = (endpoint) => {
  endpoint.configVersion = (endpoint.configVersion || 1) + 1;
};


const normalizeEndpointPath = (path) => {
  return path
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
};

const recordProxyTraffic = async ({
  serverId,
  method,
  path,
  statusCode,
  durationMs,
  bytesIn,
  bytesOut,
}) => {
  try {
    const now = new Date();

    const minute = new Date(now);
    minute.setSeconds(0, 0);

    const successful = statusCode >= 200 && statusCode < 400;
    const failed = statusCode >= 400;

    const normalizedMethod = method.toUpperCase();
    const normalizedPath = normalizeEndpointPath(path);

    // Ensure the monitoring document exists.
    // Do not refresh lastHeartbeatAt from proxy traffic.
    await MonitoringData.updateOne(
      { serverId },
      {
        $setOnInsert: {
          serverId,
          health: "unknown",
          lastHeartbeatAt: now,
        },
      },
      { upsert: true }
    );

    // Update cumulative traffic counters.
    const increments = {
      "traffic.totalRequests": 1,
      "traffic.bytesIn": bytesIn,
      "traffic.bytesOut": bytesOut,
      "traffic.totalResponseTimeMs": durationMs,
      [`traffic.methods.${normalizedMethod}`]: 1,
    };

    if (successful) {
      increments["traffic.successfulRequests"] = 1;
    }

    if (failed) {
      increments["traffic.failedRequests"] = 1;
    }

    await MonitoringData.updateOne(
      { serverId },
      { $inc: increments }
    );

    // Update or create the current minute bucket.
    const existingBucket = await MonitoringData.exists({
      serverId,
      "traffic.minuteBuckets.minute": minute,
    });

    const bucketIncrement = {
      "traffic.minuteBuckets.$.requests": 1,
      "traffic.minuteBuckets.$.bytesIn": bytesIn,
      "traffic.minuteBuckets.$.bytesOut": bytesOut,
      "traffic.minuteBuckets.$.responseTimeMs": durationMs,
    };

    if (successful) {
      bucketIncrement[
        "traffic.minuteBuckets.$.successfulRequests"
      ] = 1;
    }

    if (failed) {
      bucketIncrement[
        "traffic.minuteBuckets.$.failedRequests"
      ] = 1;
    }

    if (existingBucket) {
      await MonitoringData.updateOne(
        {
          serverId,
          "traffic.minuteBuckets.minute": minute,
        },
        { $inc: bucketIncrement }
      );
    } else {
      await MonitoringData.updateOne(
        { serverId },
        {
          $push: {
            "traffic.minuteBuckets": {
              $each: [
                {
                  minute,
                  requests: 1,
                  successfulRequests: successful ? 1 : 0,
                  failedRequests: failed ? 1 : 0,
                  bytesIn,
                  bytesOut,
                  responseTimeMs: durationMs,
                },
              ],
              $slice: -60,
            },
          },
        }
      );
    }

    // Update or create endpoint statistics.
    const existingEndpoint = await MonitoringData.exists({
      serverId,
      "traffic.endpointStats.method": normalizedMethod,
      "traffic.endpointStats.path": normalizedPath,
    });

    if (existingEndpoint) {
      const endpointIncrement = {
        "traffic.endpointStats.$.requests": 1,
        "traffic.endpointStats.$.totalResponseTimeMs": durationMs,
      };

      if (successful) {
        endpointIncrement[
          "traffic.endpointStats.$.successfulRequests"
        ] = 1;
      }

      if (failed) {
        endpointIncrement[
          "traffic.endpointStats.$.failedRequests"
        ] = 1;
      }

      await MonitoringData.updateOne(
        {
          serverId,
          "traffic.endpointStats.method": normalizedMethod,
          "traffic.endpointStats.path": normalizedPath,
        },
        {
          $inc: endpointIncrement,
          $set: {
            "traffic.endpointStats.$.lastCalledAt": now,
          },
        }
      );
    } else {
      await MonitoringData.updateOne(
        { serverId },
        {
          $push: {
            "traffic.endpointStats": {
              $each: [
                {
                  method: normalizedMethod,
                  path: normalizedPath,
                  requests: 1,
                  successfulRequests: successful ? 1 : 0,
                  failedRequests: failed ? 1 : 0,
                  totalResponseTimeMs: durationMs,
                  lastCalledAt: now,
                },
              ],
              $slice: -100,
            },
          },
        }
      );
    }
  } catch (error) {
    // Monitoring failure must not interrupt customer traffic.
    console.error("Proxy traffic monitoring failed:", error.message);
  }
};


// Verify server ownership
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

// Get owned endpoint
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

// Find a mapping
const findMappingIndex = (endpoint, deviceId, userId) => {
  return endpoint.redirectionLinks.findIndex((link) => {
    return (
      link.deviceId.toString() === deviceId &&
      link.userId.toString() === userId
    );
  });
};

// CREATE SERVER ENDPOINT
const createServerEndpoint = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;
    const { redirectionLinks, routingMode } = req.body;

    const server = await getOwnedServer(userId, serverId);

    const existing = await ServerEndpoint.exists({
      serverId: server._id,
    });

    if (existing) {
      throw createError(
        "An endpoint already exists for this server.",
        409,
        "SERVER_ENDPOINT_ALREADY_EXISTS"
      );
    }

    if (
      routingMode !== undefined &&
      !["redirect", "proxy"].includes(routingMode)
    ) {
      throw createError(
        "Invalid routing mode.",
        400,
        "INVALID_ROUTING_MODE"
      );
    }

    if (
      redirectionLinks !== undefined &&
      !Array.isArray(redirectionLinks)
    ) {
      throw createError(
        "Redirection links must be an array.",
        400,
        "INVALID_REDIRECTION_LINKS"
      );
    }

    const normalizedLinks = (redirectionLinks || []).map((link) => {
      if (!isValidObjectId(link.userId)) {
        throw createError(
          "Invalid mapped user ID.",
          400,
          "INVALID_MAPPED_USER_ID"
        );
      }

      if (!isValidObjectId(link.deviceId)) {
        throw createError(
          "Invalid device ID.",
          400,
          "INVALID_DEVICE_ID"
        );
      }

      if (
        link.priority !== undefined &&
        (!Number.isInteger(link.priority) || link.priority < 1)
      ) {
        throw createError(
          "Priority must be a positive integer.",
          400,
          "INVALID_PRIORITY"
        );
      }

      return {
        userId: link.userId,
        deviceId: link.deviceId,
        destinationLink: validateDestinationLink(link.destinationLink),
        priority: link.priority ?? 1,
        isActive: link.isActive ?? true,
      };
    });

    const endpoint = await ServerEndpoint.create({
      serverId: server._id,
      permanentLink: generatePermanentLink(
        server.slug || server.name
      ),
      redirectionLinks: normalizedLinks,
      routingMode: routingMode || "proxy",
      isActive: true,
      configVersion: 1,
    });

    return res.status(201).json({
      success: true,
      message: "Server endpoint created successfully.",
      data: { endpoint },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};

// GET SERVER ENDPOINT
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
      data: { endpoint },
    });
  } catch (error) {
    return next(error);
  }
};

// GET ALL SERVER ENDPOINTS
const getServerEndpoints = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const servers = await Server.find({
      owner: userId,
      isActive: true,
      status: { $ne: "deleted" },
    }).select("_id");

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
      data: { endpoints },
    });
  } catch (error) {
    return next(error);
  }
};

// ADD REDIRECTION LINK
const addRedirectionLink = async (req, res, next) => {
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

    if (!isValidObjectId(mappedUserId)) {
      throw createError(
        "Invalid mapped user ID.",
        400,
        "INVALID_MAPPED_USER_ID"
      );
    }

    if (!isValidObjectId(deviceId)) {
      throw createError(
        "Invalid device ID.",
        400,
        "INVALID_DEVICE_ID"
      );
    }

    if (
      priority !== undefined &&
      (!Number.isInteger(priority) || priority < 1)
    ) {
      throw createError(
        "Priority must be a positive integer.",
        400,
        "INVALID_PRIORITY"
      );
    }

    const duplicate = endpoint.redirectionLinks.some(
      (link) =>
        link.userId.toString() === mappedUserId &&
        link.deviceId.toString() === deviceId
    );

    if (duplicate) {
      throw createError(
        "A mapping already exists for this user and device.",
        409,
        "REDIRECTION_LINK_ALREADY_EXISTS"
      );
    }

    endpoint.redirectionLinks.push({
      userId: mappedUserId,
      deviceId,
      destinationLink: validateDestinationLink(
        destinationLink,
        endpoint.security.httpsOnly
      ),
      priority: priority ?? 1,
      isActive: true,
    });

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(201).json({
      success: true,
      message: "Redirection link added successfully.",
      data: {
        redirectionLinks: endpoint.redirectionLinks,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};

// UPDATE REDIRECTION LINK
const updateRedirectionLink = async (req, res, next) => {
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

    if (!isValidObjectId(mappedUserId)) {
      throw createError(
        "A valid mapped user ID is required.",
        400,
        "INVALID_MAPPED_USER_ID"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    const index = findMappingIndex(
      endpoint,
      deviceId,
      mappedUserId
    );

    if (index === -1) {
      throw createError(
        "Redirection link not found.",
        404,
        "REDIRECTION_LINK_NOT_FOUND"
      );
    }

    const updates = req.body;
    const link = endpoint.redirectionLinks[index];

    if (updates.destinationLink !== undefined) {
      link.destinationLink = validateDestinationLink(
        updates.destinationLink,
        endpoint.security.httpsOnly
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
          "INVALID_LINK_STATUS"
        );
      }

      link.isActive = updates.isActive;
    }

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Redirection link updated successfully.",
      data: {
        redirectionLink: endpoint.redirectionLinks[index],
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};

// REMOVE REDIRECTION LINK
const removeRedirectionLink = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId, deviceId } = req.params;
    const { userId: mappedUserId } = req.query;

    if (
      !isValidObjectId(deviceId) ||
      !isValidObjectId(mappedUserId)
    ) {
      throw createError(
        "Valid device ID and mapped user ID are required.",
        400,
        "INVALID_MAPPING_ID"
      );
    }

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    const index = findMappingIndex(
      endpoint,
      deviceId,
      mappedUserId
    );

    if (index === -1) {
      throw createError(
        "Redirection link not found.",
        404,
        "REDIRECTION_LINK_NOT_FOUND"
      );
    }

    endpoint.redirectionLinks.splice(index, 1);

    updateConfigVersion(endpoint);

    await endpoint.save();

    return res.status(200).json({
      success: true,
      message: "Redirection link removed successfully.",
      data: {
        redirectionLinks: endpoint.redirectionLinks,
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
        "Routing mode must be redirect or proxy.",
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

// UPDATE SECURITY SETTINGS
const updateEndpointSecurity = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.params;

    const {
      enabled,
      httpsOnly,
      allowedMethods,
      rateLimitPerMinute,
    } = req.body;

    const { endpoint } = await getOwnedEndpoint(
      userId,
      serverId
    );

    if (enabled !== undefined) {
      if (typeof enabled !== "boolean") {
        throw createError(
          "enabled must be a boolean.",
          400,
          "INVALID_SECURITY_SETTING"
        );
      }

      endpoint.security.enabled = enabled;
    }

    if (httpsOnly !== undefined) {
      if (typeof httpsOnly !== "boolean") {
        throw createError(
          "httpsOnly must be a boolean.",
          400,
          "INVALID_SECURITY_SETTING"
        );
      }

      endpoint.security.httpsOnly = httpsOnly;
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
          "Invalid allowed HTTP methods.",
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

      endpoint.security.rateLimitPerMinute = rateLimitPerMinute;
    }

    // Revalidate all destinations if HTTPS is required
    if (endpoint.security.httpsOnly) {
      for (const link of endpoint.redirectionLinks) {
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
      message: "Security settings updated successfully.",
      data: {
        security: endpoint.security,
        configVersion: endpoint.configVersion,
      },
    });
  } catch (error) {
    return handleEndpointError(error, next);
  }
};

// ACTIVATE / DEACTIVATE ENDPOINT
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
        ? "Endpoint activated successfully."
        : "Endpoint deactivated successfully.",
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
      serverId: endpoint.serverId,
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

// Select highest-priority active destination
const selectDestination = (endpoint) => {
  const activeLinks = endpoint.redirectionLinks
    .filter((link) => link.isActive)
    .sort((a, b) => a.priority - b.priority);

  if (activeLinks.length === 0) {
    throw createError(
      "No active destination is configured for this endpoint.",
      503,
      "NO_ACTIVE_DESTINATION"
    );
  }

  return activeLinks[0].destinationLink;
};

// Check server and monitoring health
const checkServerHealth = async (serverId) => {
  const server = await Server.findOne({
    _id: serverId,
    isActive: true,
    status: "running",
  }).select("_id status monitoringEnabled");

  if (!server) {
    throw createError(
      "The hosted server is not running.",
      503,
      "SERVER_NOT_RUNNING"
    );
  }

  // Monitoring disabled: don't require heartbeat data.
  if (!server.monitoringEnabled) {
    return;
  }

  const monitoringData = await MonitoringData.findOne({
    serverId,
  }).select("health lastHeartbeatAt");

  if (!monitoringData) {
    throw createError(
      "Monitoring data is unavailable.",
      503,
      "MONITORING_DATA_UNAVAILABLE"
    );
  }

  if (
    monitoringData.health === "down" ||
    monitoringData.health === "unknown"
  ) {
    throw createError(
      "The hosted server is not reporting healthy status.",
      503,
      "SERVER_UNHEALTHY"
    );
  }

  const maxHeartbeatAge = Number(
    process.env.SERVER_HEARTBEAT_MAX_AGE_MS || 120000
  );

  const heartbeatAge =
    Date.now() -
    new Date(monitoringData.lastHeartbeatAt).getTime();

  if (
    !Number.isFinite(heartbeatAge) ||
    heartbeatAge < 0 ||
    heartbeatAge > maxHeartbeatAge
  ) {
    throw createError(
      "The server heartbeat is stale.",
      503,
      "SERVER_HEARTBEAT_STALE"
    );
  }
};

// Rewrite upstream absolute redirects to the permanent URL
const rewriteLocationHeader = (
  proxyRes,
  destinationUrl,
  permanentId
) => {
  const location = proxyRes.headers.location;

  if (!location) {
    return;
  }

  try {
    const upstreamUrl = new URL(location, destinationUrl);

    if (upstreamUrl.origin !== destinationUrl.origin) {
      return;
    }

    const publicBase = new URL(getPublicBaseUrl());

    proxyRes.headers.location =
      `${publicBase.origin}/s/${permanentId}` +
      `${upstreamUrl.pathname}${upstreamUrl.search}${upstreamUrl.hash}`;
  } catch {
    // Leave invalid upstream Location headers unchanged
  }
};

// Shared proxy response listener

proxy.on("proxyRes", (proxyRes, req) => {
  if (req.__spareShareDestinationUrl && req.__spareSharePermanentId) {
    rewriteLocationHeader(
      proxyRes,
      req.__spareShareDestinationUrl,
      req.__spareSharePermanentId
    );
  }

  let bytesOut = 0;
  proxyRes.on("data", (chunk) => {bytesOut += chunk.length;});
  proxyRes.on("end", () => {req.__spareShareBytesOut = bytesOut;});
});


// PUBLIC REVERSE PROXY HANDLER
const proxyTraffic = async (req, res, next) => {
  try {
    const{permanentId} = req.params;

    if(typeof permanentId !== "string" || !/^[a-z0-9-]+$/.test(permanentId)) {
      throw createError(
        "Invalid permanent endpoint identifier.",
        400,
        "INVALID_PERMANENT_ID"
      );
    }

    const permanentLink = `${getPublicBaseUrl()}/${permanentId}`;

    const endpoint = await ServerEndpoint.findOne({permanentLink, isActive: true,});

    if(!endpoint) {
      throw createError(
        "Endpoint not found or inactive.",
        404,
        "SERVER_ENDPOINT_NOT_FOUND"
      );
    }

    if (endpoint.security.enabled && !endpoint.security.allowedMethods.includes(req.method)){
      throw createError(
        "HTTP method is not allowed.",
        405,
        "HTTP_METHOD_NOT_ALLOWED"
      );
    }

    await checkServerHealth(endpoint.serverId);

    const destination = validateDestinationLink(
      selectDestination(endpoint),
      endpoint.security.httpsOnly
    );

    const destinationUrl = new URL(destination);

    // Extract the path following /s/:permanentId
    const incomingUrl = new URL(
      req.originalUrl,
      "http://internal.local"
    );

    const prefix = `/s/${permanentId}`;

    let remainingPath = incomingUrl.pathname.slice(
      prefix.length
    );

    if (!remainingPath.startsWith("/")) {
      remainingPath = `/${remainingPath}`;
    }

    if (remainingPath === "/") {
      remainingPath = "";
    }

    const basePath = destinationUrl.pathname.replace(/\/+$/, "");

    const forwardedPath =
      `${basePath}${remainingPath}` || "/";

    // Preserve the incoming query string
    req.url = `${forwardedPath}${incomingUrl.search}`;

    // Do not cache proxied responses
    res.setHeader("Cache-Control", "no-store");

    // Avoid exposing the upstream host in referrer metadata
    res.setHeader("Referrer-Policy", "same-origin");

    // Attach request-specific metadata before proxying
    req.__spareShareDestinationUrl = destinationUrl;
    req.__spareSharePermanentId = permanentId;


    const requestStartedAt = Date.now();
    const bytesIn = Number(req.headers["content-length"] || 0);

    res.once("finish", () => {
      const durationMs = Date.now() - requestStartedAt;

      recordProxyTraffic({
        serverId: endpoint.serverId,
        method: req.method,
        path: remainingPath || "/",
        statusCode: res.statusCode,
        durationMs,
        bytesIn,
        bytesOut: req.__spareShareBytesOut || 0,
      });
    });

    proxy.web(
      req,
      res,
      {
        target: destinationUrl.origin,
        changeOrigin: true,
        xfwd: true,
        secure: true,
        prependPath: false,
        proxyTimeout: 30000,
        timeout: 30000,
        cookieDomainRewrite: "",
      },
      (error) => {
        if (res.headersSent) {
          return res.destroy(error);
        }

        return next(
          createError(
            "The destination server could not be reached.",
            502,
            "UPSTREAM_SERVER_ERROR"
          )
        );
      }
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createServerEndpoint,
  getServerEndpoint,
  getServerEndpoints,
  addRedirectionLink,
  updateRedirectionLink,
  removeRedirectionLink,
  updateRoutingMode,
  updateEndpointSecurity,
  updateEndpointStatus,
  deleteServerEndpoint,
  proxyTraffic,
};