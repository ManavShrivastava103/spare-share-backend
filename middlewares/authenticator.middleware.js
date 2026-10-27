const jwt = require("jsonwebtoken");
const UserSession = require("../models/userSession.model");

const authenticator =  (isPremiumRequired = false) => {
return async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Authorization header missing
    if (!authHeader) {
      const error = new Error("Authentication token is required.");
      error.statusCode = 401;
      error.code = "AUTH_TOKEN_REQUIRED";
      throw error;
    }

    // Invalid format
    if (!authHeader.startsWith("Bearer ")) {
      const error = new Error("Invalid authorization format.");
      error.statusCode = 401;
      error.code = "INVALID_AUTH_HEADER";
      throw error;
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      const error = new Error("Authentication token is required.");
      error.statusCode = 401;
      error.code = "AUTH_TOKEN_REQUIRED";
      throw error;
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const {userId, email, isPremium, sessionId,} = decoded;

    if (!userId || !sessionId) {
      const error = new Error("Invalid authentication token.");
      error.statusCode = 401;
      error.code = "INVALID_TOKEN";
      throw error;
    }

    if(isPremiumRequired && !isPremium) {
      const error = new Error("Premium access is required for this resource.");
      error.statusCode = 403;
      error.code = "PREMIUM_ACCESS_REQUIRED";
      throw error;
    }

    // Checking the server-side session
    const session = await UserSession.findOne({
      userId,
      sessionId,
      status: "active",
      expiresAt: {
        $gt: new Date(),
      },
    }).select("_id sessionId clientDeviceId expiresAt");

    if (!session) {
      const error = new Error("Your session has expired or has been revoked.");
      error.statusCode = 401;
      error.code = "SESSION_INVALID";
      throw error;
    }

    // Attach authenticated information
    req.user = {userId, email, isPremium};
    req.session = {
      id: session.sessionId,
      dbId: session._id,
      clientDeviceId: session.clientDeviceId,
      expiresAt: session.expiresAt,
    };

    next();
  } catch (error) {
    next(error);
  }
}};

module.exports = authenticator;