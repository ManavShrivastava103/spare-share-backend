
const express = require("express");

const router = express.Router();

const authenticator = require(
  "../middlewares/authenticator.middleware"
);

const controller = require(
  "../controllers/serverEnvironment.controller"
);


// All environment-management routes require user authentication.

router.get(
  "/:serverId",
  authenticator(),
  controller.getEnvironment
);

router.put(
  "/:serverId",
  authenticator(),
  controller.saveEnvironment
);

router.delete(
  "/:serverId/:key",
  authenticator(),
  controller.deleteEnvironmentVariable
);

router.post(
  "/:serverId/sync",
  authenticator(),
  controller.syncEnvironment
);


module.exports = router;
