
const express = require("express");
const router = express.Router();

const authenticator = require("../middlewares/authenticator.middleware");
const {
startGitHubInstallation,
completeGitHubInstallation,
handleGitHubWebhook,
} = require("../controllers/github.controller");

router.post("/install", authenticator(), startGitHubInstallation);
router.get("/setup", completeGitHubInstallation);
router.post("/webhook", handleGitHubWebhook);

module.exports = router;
