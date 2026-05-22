const cron = require("node-cron");
const https = require("https");

const IMAGE_NAME = process.env.DOCKER_IMAGE || "ghcr.io/neightgar/labstock";
const TAG = process.env.DOCKER_TAG || "latest";
const CHECK_INTERVAL = process.env.UPDATE_CHECK_INTERVAL || "0 6 * * *"; // daily at 06:00

function getManifestDigest() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "ghcr.io",
      path: `/v2/${IMAGE_NAME}/manifests/${TAG}`,
      method: "GET",
      headers: {
        Accept: "application/vnd.docker.distribution.manifest.v2+json",
      },
    };

    const req = https.request(options, (res) => {
      const digest = res.headers["docker-content-digest"];
      if (digest) {
        resolve(digest);
      } else {
        reject(new Error("No digest header"));
      }
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

let lastKnownDigest = null;

async function checkForUpdates() {
  try {
    const currentDigest = await getManifestDigest();

    if (!lastKnownDigest) {
      lastKnownDigest = currentDigest;
      console.log(`[updates] Initial digest recorded: ${currentDigest.slice(0, 19)}...`);
      return;
    }

    if (currentDigest !== lastKnownDigest) {
      console.log(`[updates] New image available! Current: ${lastKnownDigest.slice(0, 19)}... → New: ${currentDigest.slice(0, 19)}...`);
      console.log("[updates] Update via Container Manager or: docker compose pull && docker compose up -d");
      lastKnownDigest = currentDigest;
    } else {
      console.log("[updates] Image is up to date");
    }
  } catch (err) {
    console.error("[updates] Failed to check for updates:", err.message);
  }
}

function startUpdateCheckJob() {
  // Run initial check on startup
  checkForUpdates();

  // Schedule periodic checks
  cron.schedule(CHECK_INTERVAL, () => {
    checkForUpdates();
  });

  console.log(`[updates] Update check scheduled at ${CHECK_INTERVAL}`);
}

module.exports = { startUpdateCheckJob, checkForUpdates };