
const crypto = require("crypto");
const mongoose = require("mongoose");

const Server = require("../models/server.model");
const ServerEnvironment = require("../models/serverEnvironment.model");
const DeviceServer = require("../models/deviceServer.model");

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};


// ============================================================
// ENCRYPTION CONFIGURATION
// ============================================================

const getEncryptionKey = () => {
  const key = process.env.ENV_ENCRYPTION_KEY;

  if (
    typeof key !== "string" ||
    !/^[a-f0-9]{64}$/i.test(key)
  ) {
    throw createError(
      "Environment encryption key is missing or invalid.",
      500,
      "ENV_ENCRYPTION_KEY_INVALID"
    );
  }

  return Buffer.from(key, "hex");
};


const encryptVariables = (variables) => {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify(variables),
      "utf8"
    ),
    cipher.final(),
  ]);

  return {
    encryptedData: encrypted.toString("base64"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    keyVersion: 1,
  };
};


const decryptVariables = (environment) => {
  try {
    if (environment.keyVersion !== 1) {
      throw new Error("Unsupported encryption key version.");
    }

    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(environment.iv, "hex")
    );

    decipher.setAuthTag(
      Buffer.from(environment.authTag, "hex")
    );

    const decrypted = Buffer.concat([
      decipher.update(
        Buffer.from(environment.encryptedData, "base64")
      ),
      decipher.final(),
    ]);

    const variables = JSON.parse(
      decrypted.toString("utf8")
    );

    if (
      !variables ||
      typeof variables !== "object" ||
      Array.isArray(variables)
    ) {
      throw new Error("Invalid environment configuration.");
    }

    return variables;

  } catch (error) {
    if (error.code === "ENV_ENCRYPTION_KEY_INVALID") {
      throw error;
    }

    throw createError(
      "Unable to decrypt the server environment configuration.",
      500,
      "ENVIRONMENT_DECRYPTION_FAILED"
    );
  }
};


// ============================================================
// VALIDATION
// ============================================================

const validateVariable = (variable) => {
  if (
    !variable ||
    typeof variable !== "object" ||
    Array.isArray(variable)
  ) {
    throw createError(
      "Invalid environment variable.",
      400,
      "INVALID_ENVIRONMENT_VARIABLE"
    );
  }

  const { key, value, target = "both" } = variable;

  if (
    typeof key !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
  ) {
    throw createError(
      "Environment variable name is invalid.",
      400,
      "INVALID_ENVIRONMENT_KEY"
    );
  }

  if (key.startsWith("SPARESHARE_")) {
    throw createError(
      "Environment variable names beginning with SPARESHARE_ are reserved.",
      400,
      "RESERVED_ENVIRONMENT_KEY"
    );
  }

  if (
    typeof value !== "string" ||
    value.length > 16384 ||
    value.includes("\0")
  ) {
    throw createError(
      "Environment variable value must be a string of at most 16 KB.",
      400,
      "INVALID_ENVIRONMENT_VALUE"
    );
  }

  if (!["file", "process", "both"].includes(target)) {
    throw createError(
      "Environment target must be file, process, or both.",
      400,
      "INVALID_ENVIRONMENT_TARGET"
    );
  }

  return {
    key,
    value,
    target,
  };
};


// ============================================================
// SERVER AUTHORIZATION
// ============================================================

const assertServerOwner = async ({
  serverId,
  userId,
}) => {
  if (
    !isValidObjectId(serverId) ||
    !isValidObjectId(userId)
  ) {
    throw createError(
      "Invalid server or user identifier.",
      400,
      "INVALID_IDENTIFIER"
    );
  }

  const server = await Server.findOne({
    _id: serverId,
    owner: userId,
    isActive: true,
  });

  if (!server) {
    throw createError(
      "Server not found or you do not own this server.",
      404,
      "SERVER_NOT_FOUND"
    );
  }

  return server;
};


// ============================================================
// GET ENVIRONMENT CONFIGURATION
// ============================================================

const getServerEnvironment = async ({
  serverId,
  userId,
}) => {
  await assertServerOwner({
    serverId,
    userId,
  });

  const environment = await ServerEnvironment.findOne({
    serverId,
  }).select("+encryptedData +iv +authTag");

  if (!environment) {
    return {
      serverId,
      revision: 0,
      variables: [],
      updatedAt: null,
    };
  }

  const decrypted = decryptVariables(environment);

  const variables = Object.entries(decrypted).map(
    ([key, item]) => ({
      key,
      value: "••••••••",
      target: item.target,
      isConfigured: true,
    })
  );

  return {
    serverId,
    revision: environment.revision,
    variables,
    updatedAt: environment.updatedAt,
  };
};


// ============================================================
// CREATE OR UPDATE VARIABLES
// ============================================================

const updateServerEnvironment = async ({
  serverId,
  userId,
  variables,
}) => {
  await assertServerOwner({
    serverId,
    userId,
  });

  if (
    !Array.isArray(variables) ||
    variables.length === 0 ||
    variables.length > 200
  ) {
    throw createError(
      "Provide between 1 and 200 environment variables.",
      400,
      "INVALID_ENVIRONMENT_VARIABLES"
    );
  }

  const validatedVariables = variables.map(
    validateVariable
  );

  const uniqueKeys = new Set(
    validatedVariables.map((item) => item.key)
  );

  if (uniqueKeys.size !== validatedVariables.length) {
    throw createError(
      "Duplicate environment variable names are not allowed.",
      400,
      "DUPLICATE_ENVIRONMENT_KEYS"
    );
  }

  const existing = await ServerEnvironment.findOne({
    serverId,
  }).select("+encryptedData +iv +authTag");

  const currentVariables = existing
    ? decryptVariables(existing)
    : {};

  for (const variable of validatedVariables) {
    currentVariables[variable.key] = {
      value: variable.value,
      target: variable.target,
    };
  }

  const totalSize = Buffer.byteLength(
    JSON.stringify(currentVariables),
    "utf8"
  );

  if (totalSize > 65536) {
    throw createError(
      "Total environment configuration cannot exceed 64 KB.",
      400,
      "ENVIRONMENT_SIZE_LIMIT_EXCEEDED"
    );
  }

  const encrypted = encryptVariables(
    currentVariables
  );

  const environment = await ServerEnvironment.findOneAndUpdate(
    { serverId },
    {
      $set: {
        ...encrypted,
        updatedBy: userId,
      },
      $inc: {
        revision: 1,
      },
      $setOnInsert: {
        serverId,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  return {
    serverId,
    revision: environment.revision,
    variableCount: Object.keys(currentVariables).length,
    updatedAt: environment.updatedAt,
  };
};


// ============================================================
// DELETE ONE VARIABLE
// ============================================================

const deleteServerEnvironmentVariable = async ({
  serverId,
  userId,
  key,
}) => {
  await assertServerOwner({
    serverId,
    userId,
  });

  if (
    typeof key !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
  ) {
    throw createError(
      "Invalid environment variable name.",
      400,
      "INVALID_ENVIRONMENT_KEY"
    );
  }

  const environment = await ServerEnvironment.findOne({
    serverId,
  }).select("+encryptedData +iv +authTag");

  if (!environment) {
    throw createError(
      "Environment configuration not found.",
      404,
      "ENVIRONMENT_NOT_FOUND"
    );
  }

  const variables = decryptVariables(environment);

  if (!Object.prototype.hasOwnProperty.call(variables, key)) {
    throw createError(
      "Environment variable not found.",
      404,
      "ENVIRONMENT_VARIABLE_NOT_FOUND"
    );
  }

  delete variables[key];

  const encrypted = encryptVariables(variables);

  environment.encryptedData = encrypted.encryptedData;
  environment.iv = encrypted.iv;
  environment.authTag = encrypted.authTag;
  environment.keyVersion = encrypted.keyVersion;
  environment.revision += 1;
  environment.updatedBy = userId;

  await environment.save();

  return {
    serverId,
    deletedKey: key,
    revision: environment.revision,
    variableCount: Object.keys(variables).length,
  };
};


// ============================================================
// DEVICE AGENT: FETCH DECRYPTED CONFIGURATION
// ============================================================

const getEnvironmentForAgent = async ({
  device,
  serverId,
}) => {
  if (!isValidObjectId(serverId)) {
    throw createError(
      "Invalid server identifier.",
      400,
      "INVALID_SERVER_ID"
    );
  }

  const { server } = await require(
    "../services/hosting.service"
  ).assertDeviceServerAssignment(
    device._id,
    serverId
  );

  const environment = await ServerEnvironment.findOne({
    serverId: server._id,
  }).select("+encryptedData +iv +authTag");

  if (!environment) {
    return {
      serverId: server._id,
      revision: 0,
      variables: {},
    };
  }

  return {
    serverId: server._id,
    revision: environment.revision,
    variables: decryptVariables(environment),
  };
};


module.exports = {
  createError,
  getServerEnvironment,
  updateServerEnvironment,
  deleteServerEnvironmentVariable,
  getEnvironmentForAgent,
  assertServerOwner,
};
