const path = require("path");
const fs = require("fs");

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

    fileStream.on("open", () => {
      console.log("[ROOTFS] File stream opened.");
    });

    fileStream.on("end", () => {
      console.log("[ROOTFS] Archive download completed.");
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error("[ROOTFS] Controller error:", error.message);
    next(error);
  }
};

module.exports = {
  downloadRootfs
};