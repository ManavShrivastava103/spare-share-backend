const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const OTP = require("../models/otp.model");
const UserSession = require("../models/userSession.model");
const Device = require("../models/device.model");

const { sendOtpEmail } = require("../services/email.service");
const { generateDeviceName } = require("./installation.controller");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 10;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
const MAX_SESSIONS_PER_USER = Number(process.env.MAX_SESSIONS_PER_USER) || 5;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 30;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

// Helper Functions
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const generateSessionId = () => crypto.randomUUID();
const generateRefreshToken = () => crypto.randomBytes(64).toString("hex");
const hashToken = async (token) => bcrypt.hash(token, BCRYPT_ROUNDS);
const verifyTokenHash = async (token, hash) => bcrypt.compare(token, hash);
const createAccessToken = (user, sessionId) => jwt.sign({ userId: user._id.toString(), email: user.email, isPremium: user.isPremium, sessionId, }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });


// OTP CREATOR AND SENDER FUNCTION
const createAndSendOtp = async ({ email, purpose, userName, session }) => {
  const normalizedEmail = normalizeEmail(email);
  const existingOtp = await OTP.findOne({ email: normalizedEmail, purpose }).sort({ createdAt: -1 }).session(session);

  if (existingOtp) {
    const secondsSinceCreation = (Date.now() - existingOtp.createdAt.getTime()) / 1000;
    if (secondsSinceCreation < 60) {
      const retryAfter = Math.ceil(60 - secondsSinceCreation);
      const error = new Error(`Please wait ${retryAfter} seconds before requesting another OTP.`);
      error.statusCode = 429;
      error.code = "OTP_COOLDOWN";
      throw error;
    }
  }

  await OTP.deleteMany({ email: normalizedEmail, purpose }, { session });

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const otpRecord = await OTP.create([{ email: normalizedEmail, otpHash, purpose, expiresAt, attempts: 0, isUsed: false }], { session });
  const createdOtp = otpRecord[0];

  return { otp, otpRecordId: createdOtp._id, email: normalizedEmail, purpose, userName };
};


// Function to create a new user session, ensuring that the maximum number of active sessions is not exceeded and handling session revocation for the same device if necessary.
const createUserSession = async ({ user, req, clientDeviceId, session }) => {
  const now = new Date();
  await UserSession.updateMany({ userId: user._id, status: "active", expiresAt: { $lte: now } }, { $set: { status: "expired" } }, { session });
  const activeSessions = await UserSession.countDocuments({ userId: user._id, status: "active", expiresAt: { $gt: now } }).session(session);
  if (clientDeviceId) {
    await UserSession.updateMany({ userId: user._id, clientDeviceId, status: "active" }, { $set: { status: "revoked", revokedAt: now, revokedReason: "new-login-same-device" } }, { session });
  }
  const currentActiveCount = clientDeviceId ? Math.max(0, activeSessions - 1) : activeSessions;
  if (currentActiveCount >= MAX_SESSIONS_PER_USER) {
    const error = new Error(`Maximum ${MAX_SESSIONS_PER_USER} active devices allowed.`);
    error.statusCode = 409;
    error.code = "MAX_SESSIONS_REACHED";
    throw error;
  }
  const sessionId = generateSessionId();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = await hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const createdSessions = await UserSession.create([{
    userId: user._id,
    sessionId,
    clientDeviceId,
    refreshTokenHash,
    userAgent: req.get("user-agent"),
    ipAddress: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    status: "active",
    lastActiveAt: now,
    expiresAt
  }], { session });
  const createdSession = createdSessions[0];
  return { accessToken: createAccessToken(user, createdSession.sessionId), refreshToken, sessionId: createdSession.sessionId, expiresAt };
};


// Function to Register New User and send OTP for email verification.
const sendRegistrationOtp = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { name, email } = req.body;
    // Validate input
    if (!name || !email) {
      const error = new Error("Name and email are required.");
      error.statusCode = 400;
      error.code = "REQUIRED_FIELDS_MISSING";
      throw error;
    }
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const error = new Error("Invalid email format.");
      error.statusCode = 400;
      error.code = "INVALID_EMAIL_FORMAT";
      throw error;
    }
    const normalizedEmail = normalizeEmail(email);
    let otpData;
    await session.withTransaction(async () => {
      const existingUser = await User.findOne({ email: normalizedEmail }).session(session);
      if (existingUser) {
        const error = new Error("An account with this email already exists.");
        error.statusCode = 409;
        error.code = "EMAIL_ALREADY_EXISTS";
        throw error;
      }
      otpData = await createAndSendOtp({ email: normalizedEmail, purpose: "email-verification", userName: name.trim(), session });
    });

    try {
      await sendOtpEmail({ email: otpData.email, otp: otpData.otp, purpose: otpData.purpose, userName: otpData.userName });
    } catch (emailError) {
      const cleanupSession = await mongoose.startSession();
      try {
        await cleanupSession.withTransaction(async () => {
          await OTP.deleteOne({ _id: otpData.otpRecordId }, { session: cleanupSession });
        });
      } finally {
        await cleanupSession.endSession();
      }
      throw emailError;
    }
    return res.status(200).json({
      success: true,
      message: "OTP sent to your email. Please verify your email to complete registration.",
      data: {
        email: normalizedEmail,
        isEmailVerified: false
      }
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Verify Email and Create User
const completeRegistration = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { name, email, password, otp, roleType, consent } = req.body;
    // Validate required fields
    if (!name || !email || !password || !otp) {
      const error = new Error("Name, email, password and OTP are required.");
      error.statusCode = 400;
      error.code = "REQUIRED_FIELDS_MISSING";
      throw error;
    }
    const normalizedEmail = normalizeEmail(email);
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const error = new Error("Invalid email format.");
      error.statusCode = 400;
      error.code = "INVALID_EMAIL_FORMAT";
      throw error;
    }
    // Validate password strength
    if (password.length < 8) {
      const error = new Error("Password must be at least 8 characters long.");
      error.statusCode = 400;
      error.code = "WEAK_PASSWORD";
      throw error;
    }
    await session.withTransaction(async () => {
      const existingUser = await User.findOne({ email: normalizedEmail }).session(session);
      // Check if user already exists
      if (existingUser) {
        const error = new Error("An account with this email already exists.");
        error.statusCode = 409;
        error.code = "EMAIL_ALREADY_EXISTS";
        throw error;
      }
      // Find the OTP record for email verification
      const otpRecord = await OTP.findOne({
        email: normalizedEmail,
        purpose: "email-verification",
        expiresAt: { $gt: new Date() },
      }).select("+otpHash").session(session);
      // Check if OTP record exists and is valid
      if (!otpRecord) {
        const error = new Error("Invalid or expired OTP.");
        error.statusCode = 400;
        error.code = "INVALID_OR_EXPIRED_OTP";
        throw error;
      }
      // Check if the number of attempts has exceeded the maximum allowed
      if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
        const error = new Error("Too many failed attempts. Please request a new OTP.");
        error.statusCode = 400;
        error.code = "TOO_MANY_FAILED_ATTEMPTS";
        throw error;
      }
      // Increment the attempts counter and verify the OTP
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } }, { session });
      // Compare the provided OTP with the hashed OTP in the database
      const isValid = await bcrypt.compare(String(otp), otpRecord.otpHash);
      if (!isValid) {
        const error = new Error("Invalid OTP.");
        error.statusCode = 400;
        error.code = "INVALID_OTP";
        throw error;
      }
      if(!consent || consent.termsAccepted !== true || consent.privacyPolicyAccepted !== true ) {
        const error = new Error("You must accept the terms and privacy policy to register.");
        error.statusCode = 400;
        error.code = "CONSENT_REQUIRED";
        throw error;
      }
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      // Create the new user and mark the OTP as used
      await User.create([{
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        isEmailVerified: true,
        roleType: roleType || "Other",
        isActive: true,
        consent: {
          termsAccepted: true,
          privacyPolicyAccepted: true,
          acceptedAt: new Date(),
          version: "1.0",
        },
      }], { session });
      // Delete the OTP record after successful verification
      await OTP.deleteOne({ _id: otpRecord._id }, { session });
    });
    return res.status(201).json({
      success: true,
      message: "Registration completed successfully. Your email has been verified."
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Login User with Email and Password.
const loginWithPassword = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { email, password, clientDeviceId, deviceId } = req.body;
    const normalizedEmail = normalizeEmail(email);
    // Validate required fields
    if (!normalizedEmail || !password) {
      const error = new Error("Email and password are required.");
      error.statusCode = 400;
      error.code = "REQUIRED_FIELDS_MISSING";
      throw error;
    }
    // finding the user by email and selecting the password hash for verification
    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash").session(session);
    // Check if the user exists and has a password hash
    if (!user || !user.passwordHash) {
      const error = new Error("Invalid email or password.");
      error.statusCode = 401;
      error.code = "INVALID_CREDENTIALS";
      throw error;
    }
    // Check if the user account is active and email is verified
    if (!user.isActive) {
      const error = new Error("Your account is disabled.");
      error.statusCode = 403;
      error.code = "ACCOUNT_DISABLED";
      throw error;
    }
    if (!user.isEmailVerified) {
      const error = new Error("Please verify your email before logging in.");
      error.statusCode = 403;
      error.code = "EMAIL_NOT_VERIFIED";
      throw error;
    }
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    // If the password is invalid, throw an error with a specific message and status code
    if (!passwordValid) {
      const error = new Error("Invalid email or password.");
      error.statusCode = 401;
      error.code = "INVALID_CREDENTIALS";
      throw error;
    }
    let sessionData;
    await session.withTransaction(async () => {
      sessionData = await createUserSession({ user, req, clientDeviceId, session });
      await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }, { session });
    });
    // Update the Device record to associate it with the logged-in user if a deviceId is provided
    if(deviceId){
      const device = await Device.findOne({ deviceId }).session(session);
      const { manufacturer, model } = device;
      const deviceName = await generateDeviceName({userId,manufacturer,model,session});
      await Device.findOneAndUpdate({deviceId},{ $set:{userId: user._id, name: deviceName } },{session});
    }

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        sessionId: sessionData.sessionId,
        expiresAt: sessionData.expiresAt
      }
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Request Login OTP.
const requestLoginOtp = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    // Validate email format
    if (!normalizedEmail) {
      const error = new Error("Email is required.");
      error.statusCode = 400;
      error.code = "EMAIL_REQUIRED";
      throw error;
    }

    let otpData = null;
    await session.withTransaction(async () => {
      const user = await User.findOne({ email: normalizedEmail }).session(session);
      if (user && user.isActive && user.isEmailVerified) {
        otpData = await createAndSendOtp({ email: normalizedEmail, purpose: "login", userName: user.name, session });
      }
    });
    // If otpData is null, it means the email is not registered or the user is not active or email is not verified
    if (otpData) {
      try {
        await sendOtpEmail({ email: otpData.email, otp: otpData.otp, purpose: otpData.purpose, userName: otpData.userName });
      } catch (emailError) {
        const cleanupSession = await mongoose.startSession();
        try {
          await cleanupSession.withTransaction(async () => {
            await OTP.deleteOne({ _id: otpData.otpRecordId }, { session: cleanupSession });
          });
        } finally {
          await cleanupSession.endSession();
        }
        throw emailError;
      }
    }
    else {
      const error = new Error("OTP request failed. The email may not be registered or valid or the user is not active.");
      error.statusCode = 400;
      error.code = "INVALID_EMAIL_OR_OTP";
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "If the account is eligible, a login OTP has been sent."
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Login User using OTP.
const loginWithOtp = async (req, res, next) => {
    console.log("Login with OTP Body : ", req.body);
  const session = await mongoose.startSession();
  try {
    const { email, otp, clientDeviceId, deviceId } = req.body;
    const normalizedEmail = normalizeEmail(email);
    // Validate required fields
    if (!normalizedEmail || !otp) {
      const error = new Error("Email and OTP are required.");
      error.statusCode = 400;
      error.code = "REQUIRED_FIELDS_MISSING";
      throw error;
    }
    // Fetching the user to ensure they exist and are active
    const user = await User.findOne({ email: normalizedEmail }).session(session);
    // If user does not exist, is not active, or email is not verified, throw an error
    if (!user || !user.isActive || !user.isEmailVerified) {
      const error = new Error("Invalid OTP.");
      error.statusCode = 401;
      error.code = "INVALID_OTP";
      throw error;
    }
    // Fetching the OTP record for the provided email and purpose, ensuring it is not expired, not used, and has not exceeded the maximum attempts
    const otpRecord = await OTP.findOne({
      email: normalizedEmail,
      purpose: "login",
      expiresAt: { $gt: new Date() },
    }).select("+otpHash").session(session);
    // If no valid OTP record is found, throw an error indicating that the OTP is invalid or expired
    if (!otpRecord) {
      const error = new Error("Invalid or expired OTP.");
      error.statusCode = 400;
      error.code = "INVALID_OR_EXPIRED_OTP";
      throw error;
    }
    // Check if the number of attempts has exceeded the maximum allowed
    if( otpRecord.attempts >= OTP_MAX_ATTEMPTS ){
      // Delete the OTP record to prevent further attempts and throw an error indicating that the maximum attempts have been exceeded
      await OTP.deleteOne({ _id: otpRecord._id }, { session });
      const error = new Error("Maximum attempts exceeded for this OTP.");
      error.statusCode = 400;
      error.code = "MAX_ATTEMPTS_EXCEEDED";
      throw error;
    }
    // Compare the provided OTP with the hashed OTP in the database
    const isValid = await bcrypt.compare(String(otp), otpRecord.otpHash);
    if (!isValid) {
      // Increment the attempts counter for the OTP record and verify the provided OTP against the stored hash
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } }, { session });
      const error = new Error("Invalid OTP.");
      error.statusCode = 400;
      error.code = "INVALID_OTP";
      throw error;
    }
    // Mark the OTP as used and delete it from the database after successful verification
    await OTP.deleteOne({ _id: otpRecord._id }, { session });
    let sessionData;
    // Create a new user session and update the user's last login timestamp within a transaction to ensure atomicity
    await session.withTransaction(async () => {
      sessionData = await createUserSession({ user, req, clientDeviceId, session });
      await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }, { session });
    });

    // Update the Device record to associate it with the logged-in user if a deviceId is provided
    if(deviceId){
      const device = await Device.findOne({ deviceId }).session(session);
      const { manufacturer, model } = device;
      const deviceName = await generateDeviceName({userId,manufacturer,model,session});
      await Device.findOneAndUpdate({deviceId},{ $set:{userId: user._id, name: deviceName } },{session});
    }

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        sessionId: sessionData.sessionId,
        expiresAt: sessionData.expiresAt
      }
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Request Password Reset OTP.
const forgotPasswordSendOTP = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    // validating email 
    if (!normalizedEmail) {
      const error = new Error("Email is required.");
      error.statusCode = 400;
      error.code = "EMAIL_REQUIRED";
      throw error;
    }
    let otpData = null;

    await session.withTransaction(async () => {
      const user = await User.findOne({ email: normalizedEmail }).session(session);
      // Confirming that user exists and is active
      if (user && user.isActive && user.isEmailVerified) {
        otpData = await createAndSendOtp({ email: normalizedEmail, purpose: "forgot-password", userName: user.name, session });
      }
    });

    if (otpData) {
      try {
        await sendOtpEmail({ email: otpData.email, otp: otpData.otp, purpose: otpData.purpose, userName: otpData.userName });
      } catch (emailError) {
        const cleanupSession = await mongoose.startSession();
        try {
          await cleanupSession.withTransaction(async () => {
            await OTP.deleteOne({ _id: otpData.otpRecordId }, { session: cleanupSession });
          });
        } finally {
          await cleanupSession.endSession();
        }

        throw emailError;
      }
    }

    return res.status(200).json({
      success: true,
      message: "If an account exists with this email, a password reset OTP has been sent."
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Reset Password.
const resetPassword = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { email, otp, newPassword } = req.body;
    const normalizedEmail = normalizeEmail(email);
    // Validate required fields
    if (!normalizedEmail || !otp || !newPassword) {
      const error = new Error("Email, OTP and new password are required.");
      error.statusCode = 400;
      error.code = "REQUIRED_FIELDS_MISSING";
      throw error;
    }
    // Validate password strength
    if (newPassword.length < 8) {
      const error = new Error("Password must be at least 8 characters long.");
      error.statusCode = 400;
      error.code = "WEAK_PASSWORD";
      throw error;
    }
    // Fetching the user to ensure they exist and are active
    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash").session(session);
    // If user does not exist, is not active, or email is not verified, throw an error
    if (!user || !user.isActive) {
      const error = new Error("Invalid or expired OTP.");
      error.statusCode = 400;
      error.code = "INVALID_OR_EXPIRED_OTP";
      throw error;
    }
    // Fetching otp record for the provided email and purpose, ensuring it is not expired, not used
    const otpRecord = await OTP.findOne({
      email: normalizedEmail,
      purpose: "forgot-password",
      expiresAt: { $gt: new Date() },
      isUsed: false,
    }).select("+otpHash").session(session);
    // Terminate if no recrod found
    if (!otpRecord) {
      const error = new Error("Invalid or expired OTP.");
      error.statusCode = 400;
      error.code = "INVALID_OR_EXPIRED_OTP";
      throw error;
    }
    // Check if the number of attempts has exceeded the maximum allowed
    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      await OTP.deleteOne({ _id: otpRecord._id }, { session });
      const error = new Error("Maximum attempts exceeded for this OTP.");
      error.statusCode = 400;
      error.code = "MAX_ATTEMPTS_EXCEEDED";
      throw error;
    }
    const isValid = await bcrypt.compare(String(otp), otpRecord.otpHash);
    if (!isValid) {
      // Update the attemot count else.
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } }, { session });
      const error = new Error("Invalid OTP.");
      error.statusCode = 400;
      error.code = "INVALID_OTP";
      throw error;
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await user.save({ session });
    await OTP.deleteOne({ _id: otpRecord._id }, { session });
    await UserSession.updateMany({ userId: user._id, status: "active" }, { $set: { status: "revoked", revokedAt: new Date(), revokedReason: "password-reset" } }, { session });

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. Please login again."
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Refresh User Session.
const refreshSession = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { refreshToken, sessionId } = req.body;
    // Validate required fields
    if (!refreshToken || !sessionId) {
      const error = new Error("Refresh token and session ID are required.");
      error.statusCode = 401;
      error.code = "REFRESH_CREDENTIALS_REQUIRED";
      throw error;
    }
    let responseData;
    await session.withTransaction(async () => {
      const userSession = await UserSession.findOne({
        sessionId,
        status: "active",
        expiresAt: { $gt: new Date() }
      }).select("+refreshTokenHash").session(session);

      if (!userSession) {
        const error = new Error("Session expired or revoked.");
        error.statusCode = 401;
        error.code = "SESSION_INVALID";
        throw error;
      }

      const valid = await verifyTokenHash(refreshToken, userSession.refreshTokenHash);

      if (!valid) {
        userSession.status = "revoked";
        userSession.revokedAt = new Date();
        userSession.revokedReason = "invalid-refresh-token";
        await userSession.save({ session });

        const error = new Error("Invalid session.");
        error.statusCode = 401;
        error.code = "INVALID_REFRESH_TOKEN";
        throw error;
      }

      const user = await User.findById(userSession.userId).session(session);

      if (!user || !user.isActive) {
        const error = new Error("Account is unavailable.");
        error.statusCode = 401;
        error.code = "ACCOUNT_UNAVAILABLE";
        throw error;
      }

      const newRefreshToken = generateRefreshToken();

      userSession.refreshTokenHash = await hashToken(newRefreshToken);
      userSession.lastActiveAt = new Date();

      await userSession.save({ session });

      const accessToken = createAccessToken(user, userSession.sessionId);

      responseData = {
        accessToken,
        refreshToken: newRefreshToken,
        sessionId: userSession.sessionId,
        expiresAt: userSession.expiresAt
      };
    });

    return res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


// Function to Logout Current User Session.
const logout = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    if (!req.session?.id) {
      const error = new Error("Active session not found.");
      error.statusCode = 401;
      error.code = "SESSION_INVALID";
      throw error;
    }
    await session.withTransaction(async () => {
      await UserSession.updateOne(
        { sessionId: req.session.id, status: "active" },
        { $set: { status: "revoked", revokedAt: new Date(), revokedReason: "logout" } },
        { session }
      );
    });
    return res.status(200).json({
      success: true,
      message: "Logged out successfully."
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};


module.exports = {
  sendRegistrationOtp,
  completeRegistration,
  loginWithPassword,
  requestLoginOtp,
  loginWithOtp,
  forgotPasswordSendOTP,
  resetPassword,
  refreshSession,
  logout
};