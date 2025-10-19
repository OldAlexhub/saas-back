import mongoose from "mongoose";
import config from "../config/index.js";
import { loginDriver } from "../controllers/DriverAppAuth.js";

const identifier = process.argv[2];
const password = process.argv[3];
if (!identifier || !password) {
  console.error('Usage: node runLoginTest.mjs <identifier> <password>');
  process.exit(1);
}

const mockReq = {
  body: { identifier, password },
};

const mockRes = {
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    console.log('status', this.statusCode || 200, 'payload', payload);
    return payload;
  },
};

(async () => {
  await mongoose.connect(config.mongo.uri);
  await loginDriver(mockReq, mockRes);
  await mongoose.disconnect();
})();
