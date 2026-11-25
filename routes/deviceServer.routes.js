const express = require("express");
const router = express.Router();

const authenticator = require(
  "../middlewares/authenticator.middleware"
);

const controller = require(
  "../controllers/deviceServer.controller"
);


// CREATE ASSIGNMENT
router.post(
  "/",
  authenticator(),
  controller.createDeviceServer
);


// GET ALL ASSIGNMENTS / FILTER
router.get(
  "/",
  authenticator(),
  controller.getDeviceServers
);


// GET ASSIGNMENT BY DEVICE ID AND SERVER ID
router.get(
  "/lookup/:deviceId/:serverId",
  authenticator(),
  controller.getDeviceServerByDeviceAndServer
);


// GET ASSIGNMENT BY ASSIGNMENT ID
router.get(
  "/:assignmentId",
  authenticator(),
  controller.getDeviceServerById
);


// UPDATE ASSIGNMENT
router.patch(
  "/:assignmentId",
  authenticator(),
  controller.updateDeviceServer
);


// DELETE ASSIGNMENT
router.delete(
  "/:assignmentId",
  authenticator(),
  controller.deleteDeviceServer
);


module.exports = router;
