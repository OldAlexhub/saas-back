import { Router } from "express";
import { addAdmins, AdminLogin, AdminLogout, getMe, listAdmins, updateApproval } from "../controllers/Admins.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { loginSchema, signupSchema } from "../validators/adminSchemas.js";

const router = Router();

router.post("/", validate(signupSchema), addAdmins);
router.post("/login", authLimiter, validate(loginSchema), AdminLogin);
router.post("/logout", AdminLogout);
router.get("/me", authenticate, requireAdmin, getMe);
router.put("/:id/approval", authenticate, requireAdmin, updateApproval);
router.get("/", listAdmins);

export default router;
