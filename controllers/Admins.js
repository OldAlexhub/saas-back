import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import AdminModel from "../models/AdminSchema.js";
import config from "../config/index.js";

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

    const name = `${user.firstName} ${user.lastName}`;
    return res.status(200).json({
      message: "Login successful.",
      token,
      name,
      company: user.company,
    });
  } catch (error) {
    console.error("AdminLogin error:", error);
    return res.status(500).json({ message: "Server Error!" });
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
