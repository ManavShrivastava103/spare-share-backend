const express = require("express");

const router = express.Router();

const authenticator = require(
  "../middlewares/authenticator.middleware"
);

const controller = require(
  "../controllers/deviceServer.controller"
);


// Create a device-server assignment.
// Port is automatically allocated.
router.post(
  "/",
  authenticator(),
  controller.createDeviceServer
);


// Get all assignments.
// Optional filters: deviceId, serverId.
router.get(
  "/",
  authenticator(),
  controller.getDeviceServers
);


// Get a single assignment.
router.get(
  "/:assignmentId",
  authenticator(),
  controller.getDeviceServerById
);


// Update assignment status or priority.
router.patch(
  "/:assignmentId",
  authenticator(),
  controller.updateDeviceServer
);


// Remove an assignment (soft delete).
router.delete(
  "/:assignmentId",
  authenticator(),
  controller.deleteDeviceServer
);


module.exports = router;
