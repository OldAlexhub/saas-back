import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// APK and version live in server/public/apk/ — deployed alongside the server
const APK_DIR = path.resolve(__dirname, '../public/apk');
const APK_PATH = path.join(APK_DIR, 'app-release.apk');
const VERSION_PATH = path.join(APK_DIR, 'version.json');

function readAppVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
    return data.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export const getAppInfo = (_req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({ message: 'APK not found. Add app-release.apk to server/public/apk/.' });
  }
  const version = readAppVersion();
  const stats = fs.statSync(APK_PATH);
  return res.json({
    version,
    filename: `TaxiOps-Driver-v${version}.apk`,
    sizeBytes: stats.size,
    builtAt: stats.mtime,
  });
};

export const downloadApk = (_req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({ message: 'APK not found. Add app-release.apk to server/public/apk/.' });
  }
  const version = readAppVersion();
  res.download(APK_PATH, `TaxiOps-Driver-v${version}.apk`, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ message: 'Failed to send APK.' });
    }
  });
};
