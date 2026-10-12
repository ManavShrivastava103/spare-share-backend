const express = require("express");

const {
  sendRegistrationOtp,
  completeRegistration,
  loginWithPassword,
  requestLoginOtp,
  loginWithOtp,
  forgotPasswordSendOTP,
  resetPassword,
  refreshSession,
  logout
} = require("../controllers/auth.controller");

const authenticator = require("../middlewares/authenticator.middleware");
const router = express.Router();

// Registration
router.post("/register/send-otp", sendRegistrationOtp);
router.post("/register/complete", completeRegistration);

// Password Login
router.post("/login", loginWithPassword);

// OTP Login
router.post("/login/send-otp", requestLoginOtp);
router.post("/login/otp", loginWithOtp);

// Forgot Password
router.post("/forgot-password/send-otp", forgotPasswordSendOTP);
router.post("/forgot-password/reset", resetPassword);

// Refresh Session
router.post("/refresh", refreshSession);

// Logout
router.post("/logout", authenticator(), logout);

module.exports = router;
