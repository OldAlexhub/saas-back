import archiver from "archiver";
import PDFDocument from "pdfkit";
import { AGREEMENT_QUIZ_QUESTIONS, ENROLLME_DOCUMENT_TYPES } from "../constants/enrollme.js";
import AgreementQuizAttempt from "../models/enrollme/AgreementQuizAttempt.js";
import DriverApplication from "../models/enrollme/DriverApplication.js";
import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import IndependentContractorAgreementSubmission from "../models/enrollme/IndependentContractorAgreementSubmission.js";
import TrainingAcknowledgment from "../models/enrollme/TrainingAcknowledgment.js";
import ViolationCertificationAnnualReview from "../models/enrollme/ViolationCertificationAnnualReview.js";

function fullName(onboarding) {
  return [onboarding.driverFirstName, onboarding.driverMiddleName, onboarding.driverLastName].filter(Boolean).join(" ");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function labelize(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function renderValue(doc, key, value, depth = 0) {
  const indent = depth * 14;
  if (value === null || value === undefined || value === "" || key === "_id" || key === "__v") return;

  if (key && ["drawnSignature"].includes(key) && value) {
    doc.text(`${labelize(key)}: [Drawn signature stored electronically]`, { indent });
    return;
  }

  if (value instanceof Date || key?.toLowerCase().includes("date") || key?.toLowerCase().includes("at")) {
    const formatted = formatDate(value);
    if (formatted) doc.text(`${labelize(key)}: ${formatted}`, { indent });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return;
    doc.moveDown(0.2).font("Helvetica-Bold").text(labelize(key), { indent }).font("Helvetica");
    value.forEach((item, index) => {
      doc.text(`${index + 1}.`, { indent: indent + 8, continued: typeof item !== "object" });
      if (item && typeof item === "object") {
        Object.entries(item).forEach(([childKey, childValue]) => renderValue(doc, childKey, childValue, depth + 2));
      } else {
        doc.text(` ${String(item)}`);
      }
    });
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([childKey, childValue]) => {
      return childKey !== "_id" && childKey !== "__v" && childValue !== undefined && childValue !== null && childValue !== "";
    });
    if (entries.length === 0) return;
    if (key) doc.moveDown(0.2).font("Helvetica-Bold").text(labelize(key), { indent }).font("Helvetica");
    entries.forEach(([childKey, childValue]) => renderValue(doc, childKey, childValue, depth + 1));
    return;
  }

  doc.text(`${labelize(key)}: ${String(value)}`, { indent });
}

function addHeader(doc, title, onboarding) {
  doc.font("Helvetica-Bold").fontSize(16).text(title, { align: "center" });
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).text("Trans Voyage Taxi, LLC - EnrollMe Onboarding Packet", { align: "center" });
  doc.moveDown(0.8);
  doc.fontSize(10).text(`Driver: ${fullName(onboarding)}`);
  doc.text(`Email: ${onboarding.email || ""}`);
  doc.text(`Status: ${onboarding.status || ""}`);
  doc.text(`Generated: ${new Date().toLocaleString("en-US")}`);
  doc.moveDown();
}

function addSection(doc, title, data) {
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(12).text(title);
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(9);
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    doc.text("No data recorded.");
    return;
  }
  if (typeof data === "object") {
    Object.entries(data).forEach(([key, value]) => renderValue(doc, key, value, 0));
  } else {
    doc.text(String(data));
  }
}

function createPdfBuffer(title, onboarding, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER", autoFirstPage: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addHeader(doc, title, onboarding);
    sections.forEach((section) => addSection(doc, section.title, section.data));
    doc.moveDown();
    doc.fontSize(9).text("Company signature fields are intentionally left blank unless completed by an authorized company signer.");
    doc.font("Helvetica-Bold").text("Company signature pending");
    doc.end();
  });
}

async function loadPacket(onboardingId) {
  const [onboarding, application, agreement, quiz, training, violation] = await Promise.all([
    DriverOnboarding.findById(onboardingId).lean(),
    DriverApplication.findOne({ onboardingId }).lean(),
    IndependentContractorAgreementSubmission.findOne({ onboardingId }).lean(),
    AgreementQuizAttempt.findOne({ onboardingId }).lean(),
    TrainingAcknowledgment.findOne({ onboardingId }).lean(),
    ViolationCertificationAnnualReview.findOne({ onboardingId }).lean(),
  ]);

  if (!onboarding) {
    const err = new Error("Driver onboarding record not found.");
    err.statusCode = 404;
    throw err;
  }

  return { onboarding, application, agreement, quiz, training, violation };
}

export async function generateEnrollmeDocumentPdf(onboardingId, documentType) {
  const packet = await loadPacket(onboardingId);
  const { onboarding, application, agreement, quiz, training, violation } = packet;

  switch (documentType) {
    case ENROLLME_DOCUMENT_TYPES.DRIVER_APPLICATION:
      return createPdfBuffer("New Driver Employment Application", onboarding, [
        { title: "Applicant and Contact", data: application?.applicant },
        { title: "Address History", data: { currentAddress: application?.address, previousAddresses: application?.previousAddresses } },
        { title: "Driver License", data: application?.license },
        { title: "Driving Experience", data: application?.drivingExperience },
        { title: "Accidents Past 3 Years", data: application?.accidentsPast3Years },
        { title: "Traffic Convictions Past 3 Years", data: application?.trafficConvictionsPast3Years },
        { title: "Employment History", data: application?.employmentHistory },
        { title: "CDL 10-Year Employment History", data: application?.cdlEmploymentHistory10Years },
        { title: "Safety Performance Acknowledgment", data: application?.safetyPerformanceAcknowledgment },
        { title: "Applicant Certification and Signature", data: application?.applicantSignature },
      ]);

    case ENROLLME_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT:
      return createPdfBuffer("Independent Contractor Agreement", onboarding, [
        { title: "Agreement Version", data: { agreementVersion: agreement?.agreementVersion, effectiveDate: agreement?.effectiveDate } },
        { title: "Driver Identity", data: agreement?.driverIdentity },
        { title: "Accepted Sections", data: agreement?.acceptedSections },
        { title: "Initials and Policy Checklist", data: { initials: agreement?.initials, policyChecklistInitials: agreement?.policyChecklistInitials } },
        { title: "Driver Signature", data: agreement?.driverSignature },
        { title: "Company Signature", data: { companySignaturePending: agreement?.companySignaturePending ?? true } },
      ]);

    case ENROLLME_DOCUMENT_TYPES.AGREEMENT_QUIZ:
      return createPdfBuffer("Independent Contractor Agreement Quiz", onboarding, [
        {
          title: "Quiz Result",
          data: {
            agreementVersion: quiz?.agreementVersion,
            passed: quiz?.passed,
            score: quiz?.score,
            completedAt: quiz?.completedAt,
            attempts: quiz?.attempts,
          },
        },
        { title: "Answers", data: quiz?.answers },
        { title: "Wrong Answer History", data: quiz?.wrongAnswers },
        { title: "Question Bank Version", data: AGREEMENT_QUIZ_QUESTIONS.map((q) => ({ id: q.id, section: q.section })) },
      ]);

    case ENROLLME_DOCUMENT_TYPES.TRAINING_ACKNOWLEDGMENT:
      return createPdfBuffer("Training and Policy Acknowledgment", onboarding, [
        { title: "Acknowledgment", data: training },
      ]);

    case ENROLLME_DOCUMENT_TYPES.VIOLATION_CERTIFICATION:
      return createPdfBuffer("Record of Violation + Annual Review", onboarding, [
        { title: "Driver Certification", data: violation },
        {
          title: "Motor Carrier Annual Review",
          data: violation?.annualReview || {
            reviewStatus: "Pending management review after MVR review.",
          },
        },
      ]);

    case "driver_packet":
      return generateEnrollmePacketPdf(onboardingId);

    default: {
      const err = new Error("Unsupported generated document type.");
      err.statusCode = 400;
      throw err;
    }
  }
}

export async function generateEnrollmePacketPdf(onboardingId) {
  const packet = await loadPacket(onboardingId);
  const { onboarding, application, agreement, quiz, training, violation } = packet;
  return createPdfBuffer("Driver Onboarding Packet", onboarding, [
    { title: "Onboarding Summary", data: onboarding },
    { title: "Driver Employment Application", data: application },
    { title: "Independent Contractor Agreement Submission", data: agreement },
    { title: "Agreement Quiz Attempt", data: quiz },
    { title: "Training and Policy Acknowledgment", data: training },
    { title: "Record of Violation + Annual Review", data: violation },
  ]);
}

export async function streamEnrollmePacketZip(res, onboardingId) {
  const onboarding = await DriverOnboarding.findById(onboardingId).lean();
  if (!onboarding) {
    const err = new Error("Driver onboarding record not found.");
    err.statusCode = 404;
    throw err;
  }

  const baseName = fullName(onboarding).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "driver";
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${baseName}-enrollme-packet.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    throw err;
  });
  archive.pipe(res);

  const documentTypes = [
    ENROLLME_DOCUMENT_TYPES.DRIVER_APPLICATION,
    ENROLLME_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT,
    ENROLLME_DOCUMENT_TYPES.AGREEMENT_QUIZ,
    ENROLLME_DOCUMENT_TYPES.TRAINING_ACKNOWLEDGMENT,
    ENROLLME_DOCUMENT_TYPES.VIOLATION_CERTIFICATION,
  ];

  for (const documentType of documentTypes) {
    const buffer = await generateEnrollmeDocumentPdf(onboardingId, documentType);
    archive.append(buffer, { name: `${documentType}.pdf` });
  }

  const packet = await generateEnrollmePacketPdf(onboardingId);
  archive.append(packet, { name: "driver_packet.pdf" });

  await archive.finalize();
}
