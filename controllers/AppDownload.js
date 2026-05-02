import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve paths relative to this file: controllers/ → server/ → taxiOps/
const DRIVERAPP_ROOT = path.resolve(__dirname, '../../driverapp');
const APK_PATH = path.join(DRIVERAPP_ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
const PKG_PATH = path.join(DRIVERAPP_ROOT, 'package.json');

function readAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export const getAppInfo = (_req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({ message: 'APK not found. Run assembleRelease first.' });
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
    return res.status(404).json({ message: 'APK not found. Run assembleRelease first.' });
  }
  const version = readAppVersion();
  res.download(APK_PATH, `TaxiOps-Driver-v${version}.apk`, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ message: 'Failed to send APK.' });
    }
  });
};
