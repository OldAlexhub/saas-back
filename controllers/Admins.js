import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import AdminModel from "../models/AdminSchema.js";
import config from "../config/index.js";

const getAuthCookieOptions = (overrides = {}) => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    ...overrides,
  };
};

// LIST
export const listAdmins = async (_req, res) => {
  try {
    const admins = await AdminModel.find().select("-password").lean();
    return res.status(200).json({
      count: admins.length,
      admins,
    });
  } catch (error) {
    console.error("Error listing admins:", error);
    return res.status(500).json({ message: "Server error while fetching admins." });
  }
};

// SIGNUP
export const addAdmins = async (req, res) => {
  try {
    const {
      company,
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      approved,
      phoneNumber,
    } = req.body;

    if (!company || !firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "All required fields must be provided." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords don't match!" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await AdminModel.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = new AdminModel({
      company,
      firstName,
      lastName,
      email: normalizedEmail,
      password: hashedPassword,
      approved: approved || "no",
      phoneNumber,
    });

    await newUser.save();

    res.status(201).json({
      message: "Admin created successfully!",
    });
  } catch (error) {
    console.error("Error creating admin:", error);
    res.status(500).json({ message: "Server Error!" });
  }
};

// LOGIN
export const AdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await AdminModel.findOne({ email: normalizedEmail }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (user.approved !== "yes") {
      return res
        .status(403)
        .json({ message: "Your account is not approved yet. Please contact your admin." });
    }

    const token = jwt.sign({ userId: user._id.toString() }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    res.cookie("token", token, getAuthCookieOptions({
      maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days in ms
    }));

    const name = `${user.firstName} ${user.lastName}`;
    return res.status(200).json({
      message: "Login successful.",
      name,
      company: user.company,
    });
  } catch (error) {
    console.error("AdminLogin error:", error);
    return res.status(500).json({ message: "Server Error!" });
  }
};

// LOGOUT
export const AdminLogout = (_req, res) => {
  res.clearCookie("token", getAuthCookieOptions());
  return res.status(200).json({ message: "Logged out successfully." });
};

// ME — returns current admin profile from the cookie session
export const getMe = async (req, res) => {
  try {
    const admin = await AdminModel.findById(req.user.id).select("-password").lean();
    if (!admin) {
      return res.status(404).json({ message: "Admin not found." });
    }
    return res.status(200).json({
      name: `${admin.firstName} ${admin.lastName}`,
      email: admin.email,
      company: admin.company,
    });
  } catch (error) {
    console.error("getMe error:", error);
    return res.status(500).json({ message: "Server error." });
  }
};

// APPROVE
export const updateApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved } = req.body;

    if (!approved) {
      return res.status(400).json({ message: "Approval status is required." });
    }

    if (!["yes", "no"].includes(approved.toLowerCase())) {
      return res.status(400).json({ message: "Approval status must be 'yes' or 'no'." });
    }

    const admin = await AdminModel.findById(id);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found." });
    }

    admin.approved = approved.toLowerCase();
    await admin.save();

    res.status(200).json({
      message: `Admin ${admin.firstName} ${admin.lastName} approval set to '${admin.approved}'.`,
    });
  } catch (error) {
    console.error("Error updating approval:", error);
    res.status(500).json({ message: "Server error while updating approval." });
  }
};
