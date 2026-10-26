const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Device = require("../models/device.model");
const Counter = require("../models/counter.model");
const UserSession = require("../models/userSession.model");


// Function to Download Debian ARM64 Rootfs.
const downloadRootfs = async (req, res, next) => {
  try {
    console.log("[ROOTFS] Download request received.");
    const rootfsPath = path.join(
      __dirname,
      "..",
      "storage",
      "debian-arm64-rootfs-android.tar.gz"
    );
    console.log("[ROOTFS] Archive path:", rootfsPath);

    // Check if the Debian archive exists.
    if (!fs.existsSync(rootfsPath)) {
      console.log("[ROOTFS] Archive not found.");
      const error = new Error("Debian ARM64 rootfs archive not found.");
      error.statusCode = 404;
      error.code = "ROOTFS_NOT_FOUND";
      throw error;
    }

    console.log("[ROOTFS] Archive found.");
    // Get archive size for download progress on the client.
    const stat = await fs.promises.stat(rootfsPath);
    console.log("[ROOTFS] Archive size:", stat.size, "bytes");

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="debian-arm64-rootfs-android.tar.gz"'
    );
    console.log("[ROOTFS] Starting archive stream...");
    // Stream the archive instead of loading the entire 71 MB file into memory.
    const fileStream = fs.createReadStream(rootfsPath);
    fileStream.on("error", (error) => {
      console.error("[ROOTFS] Download stream failed:", error.message);
      if (!res.headersSent) {
        return next(error);
      }

      res.destroy(error);
    });

    fileStream.on("open", () => {console.log("[ROOTFS] File stream opened.");});
    fileStream.on("end", () => {console.log("[ROOTFS] Archive download completed.");});
    fileStream.pipe(res);

  } catch (error) {
    console.error("[ROOTFS] Controller error:", error.message);
    next(error);
  }
};


// Generate a sequential device ID inside the transaction
const generateDeviceId = async (session) => {
  const counter = await Counter.findByIdAndUpdate(
    "deviceId",
    { $inc: { sequence: 1 } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      session,
    }
  );

  return `DEVSS-${String(counter.sequence).padStart(6, "0")}`;
};


// Helper function to generate a unique device name based on manufacturer and model
const generateDeviceName = async ({userId, manufacturer, model, session}) => {
  const baseName = [manufacturer, model]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim())
    .join(" ")
    .slice(0, 100)
    .trim() || "Android Device";

  const existingDevices = await Device.find({
    userId,
    name: {$regex: new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-\\d+)?$`,"i")}})
    .select("name")
    .session(session)
    .lean();

  const existingNames = new Set(existingDevices.map((device) => device.name.toLowerCase()));
  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName;
  }
  let suffix = 2;
  while (existingNames.has(`${baseName}-${suffix}`.toLowerCase())) {
    suffix++;
  }
  return `${baseName}-${suffix}`;
};


// Device Info Fetching Function
const saveDeviceInfo = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const userId = req.user?.userId;
    const sessionId = req.session?._id;

    if (!userId) {
      const error = new Error("Authentication is required.");
      error.statusCode = 401;
      error.code = "UNAUTHORIZED";
      throw error;
    }

    const {
      androidId,
      manufacturer,
      model,
      osName,
      osVersion,
      appVersion,
      architecture,
      totalRam,
      totalStorage,
      fcmToken,
      deviceType,
    } = req.body;

    if(typeof androidId !== "string" || !androidId.trim()) {
      const error = new Error("Android installation identifier is required.");
      error.statusCode = 400;
      error.code = "ANDROID_ID_REQUIRED";
      throw error;
    }

    const normalizedAndroidId = androidId.trim();
    const now = new Date();
    let device;

    await session.withTransaction(async () => {
      // Generate a unique device name based on manufacturer and model
      const deviceName = await generateDeviceName({userId, manufacturer, model, session,});

      // Find an existing device belonging to this user
      const existingDevice = await Device.findOne({userId, androidId: normalizedAndroidId}).session(session);

      // Map incoming information to the Device schema
      const deviceInfo = {
        ...(deviceName !== undefined && {name: deviceName}),
        ...(deviceType !== undefined && {deviceType}),
        ...(osName !== undefined && {os: osName}),
        ...(osVersion !== undefined && {osVersion}),
        ...(architecture !== undefined && {architecture}),
        ...(appVersion !== undefined && {agentVersion: appVersion}),
        ...(manufacturer !== undefined && {manufacturer}),
        ...(model !== undefined && {model}),
        ...(totalRam !== undefined && {"hardware.memoryMb": totalRam}),
        ...(totalStorage !== undefined && {"hardware.storageMb": totalStorage}),
        ...(fcmToken !== undefined && {fcmToken}),
      };

      if (existingDevice) {
        // Update existing registration without consuming a new ID
        existingDevice.set(deviceInfo);
        existingDevice.lastSeenAt = now;
        existingDevice.status = "online";
        existingDevice.isActive = true;
        await existingDevice.save({ session });
        device = existingDevice;
      } 
      
      else {
        // Generate ID and create the device atomically
        const deviceId = await generateDeviceId(session);
        const [newDevice] = await Device.create(
          [
            {
              deviceId,
              userId,
              androidId: normalizedAndroidId,
              deviceType: "android",
              ...deviceInfo,
              status: "online",
              isActive: true,
              registeredAt: now,
              lastSeenAt: now,
            },
          ],
          { session }
        );
        device = newDevice;
      }

      // updating the session to set the correct device ID
      await UserSession.findByIdAndUpdate(sessionId, { deviceId: device.deviceId }, { session });

    });

    return res.status(200).json({
      success: true,
      message: "Device information saved successfully.",
      data: {
        deviceId: device.deviceId,
        deviceName: device.name,
        manufacturer: device.manufacturer,
        model: device.model,
        status: device.status,
        registeredAt: device.registeredAt,
        lastSeenAt: device.lastSeenAt,
      },
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};



module.exports = {
  saveDeviceInfo,
  downloadRootfs,
  generateDeviceName,
};