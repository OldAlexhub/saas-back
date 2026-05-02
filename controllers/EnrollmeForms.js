import {
  AGREEMENT_QUIZ_QUESTIONS,
  AGREEMENT_VERSION,
  DOCUMENT_TEMPLATE_DEFINITIONS,
  ENROLLME_DOCUMENT_TYPES,
  ENROLLME_STEPS,
} from "../constants/enrollme.js";
import AgreementQuizAttempt from "../models/enrollme/AgreementQuizAttempt.js";
import DriverApplication from "../models/enrollme/DriverApplication.js";
import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import IndependentContractorAgreementSubmission from "../models/enrollme/IndependentContractorAgreementSubmission.js";
import TrainingAcknowledgment from "../models/enrollme/TrainingAcknowledgment.js";
import ViolationCertificationAnnualReview from "../models/enrollme/ViolationCertificationAnnualReview.js";
import { recordEnrollmeAudit } from "../services/enrollmeAuditService.js";
import { encryptSensitiveValue } from "../services/enrollmeSensitiveDataService.js";
import {
  computePacketReadiness,
  computeMissingDocuments,
  markOnboardingDocumentComplete,
  nextStatusForReadiness,
  resolveOnboardingByToken,
} from "../services/enrollmeOnboardingService.js";

function metadataFromRequest(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    savedAt: new Date(),
  };
}

function optionalDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function signatureFromBody(req, body, documentVersion) {
  return {
    signerName: body.signerName,
    typedSignature: body.typedSignature,
    drawnSignature: body.drawnSignature,
    signedAt: new Date(),
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    documentType: body.documentType,
    documentTitle: body.documentTitle,
    documentVersion: body.documentVersion || documentVersion,
    effectiveDate: optionalDate(body.effectiveDate),
    generatedAt: optionalDate(body.generatedAt),
    reviewedAt: optionalDate(body.reviewedAt),
    acknowledgmentText: body.acknowledgmentText,
    electronicSignatureConsent: Boolean(body.electronicSignatureConsent),
    dataSnapshot: body.dataSnapshot,
    contentSnapshot: body.contentSnapshot,
    contentHash: body.contentHash,
    accepted: true,
  };
}

function reviewEventFromBody(req, body) {
  return {
    documentType: body.documentType,
    documentTitle: body.documentTitle,
    documentVersion: body.documentVersion,
    effectiveDate: optionalDate(body.effectiveDate),
    generatedAt: optionalDate(body.generatedAt),
    reviewedAt: optionalDate(body.reviewedAt) || new Date(),
    dataSnapshot: body.dataSnapshot,
    contentSnapshot: body.contentSnapshot,
    contentHash: body.contentHash,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  };
}

function publicQuestion(question) {
  if (!question) return null;
  return {
    id: question.id,
    prompt: question.prompt,
    options: question.options,
    section: question.section,
  };
}

function nextQuizQuestion(attempt) {
  const correctIds = new Set((attempt?.answers || []).filter((answer) => answer.correct).map((answer) => answer.questionId));
  return AGREEMENT_QUIZ_QUESTIONS.find((question) => !correctIds.has(question.id)) || null;
}

function normalizeAnswer(answer) {
  if (Array.isArray(answer)) return answer.map((item) => String(item).trim()).sort().join("|");
  return String(answer ?? "").trim();
}

function isCorrectAnswer(question, answer) {
  return normalizeAnswer(question.correctAnswer) === normalizeAnswer(answer);
}

async function ensureApplication(onboarding) {
  return DriverApplication.findOneAndUpdate(
    { onboardingId: onboarding._id },
    {
      $setOnInsert: {
        onboardingId: onboarding._id,
        applicant: {
          firstName: onboarding.driverFirstName,
          middleName: onboarding.driverMiddleName,
          lastName: onboarding.driverLastName,
          email: onboarding.email,
          phone: onboarding.phone,
        },
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+applicant.ssnEncrypted");
}

async function ensureAgreement(onboarding) {
  return IndependentContractorAgreementSubmission.findOneAndUpdate(
    { onboardingId: onboarding._id },
    {
      $setOnInsert: {
        onboardingId: onboarding._id,
        agreementVersion: AGREEMENT_VERSION,
        driverIdentity: {
          firstName: onboarding.driverFirstName,
          middleName: onboarding.driverMiddleName,
          lastName: onboarding.driverLastName,
          email: onboarding.email,
          phone: onboarding.phone,
        },
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function ensureViolation(onboarding) {
  return ViolationCertificationAnnualReview.findOneAndUpdate(
    { onboardingId: onboarding._id },
    { $setOnInsert: { onboardingId: onboarding._id, motorCarrierName: "Trans Voyage Taxi, LLC" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function validateStepData(onboarding, step, data) {
  if (step === "identity" && data.applicant?.ssn) {
    const digits = String(data.applicant.ssn).replace(/\D/g, "");
    if (digits.length < 4) {
      const err = new Error("SSN must include at least four digits.");
      err.statusCode = 400;
      throw err;
    }
  }

  if (step === "employment-application" && data.license?.expirationDate && !onboarding.configuration?.allowExpiredLicenseException) {
    const expirationDate = new Date(data.license.expirationDate);
    if (!Number.isNaN(expirationDate.getTime()) && expirationDate < new Date()) {
      const err = new Error("Driver license expiration cannot be in the past unless an admin allows an exception.");
      err.statusCode = 400;
      throw err;
    }
  }

  if (step === "employment-history" && (!Array.isArray(data.employmentHistory) || data.employmentHistory.length === 0)) {
    const err = new Error("At least 3 years of employment history should be requested before continuing.");
    err.statusCode = 400;
    throw err;
  }
}

function ssnLast4(ssn) {
  const digits = String(ssn || "").replace(/\D/g, "");
  return (digits || String(ssn || "")).slice(-4);
}

function applyApplicantData(application, applicant = {}) {
  const { ssn, ...safeApplicant } = applicant || {};
  const current = application.applicant?.toObject?.() || application.applicant || {};
  application.applicant = { ...current, ...safeApplicant };

  if (ssn) {
    application.applicant.ssnEncrypted = encryptSensitiveValue(ssn);
    application.applicant.ssnLast4 = ssnLast4(ssn);
  }
}

async function applyStepData(req, onboarding, step, data = {}) {
  await validateStepData(onboarding, step, data);

  if (step === "identity") {
    onboarding.driverFirstName = data.applicant?.firstName || onboarding.driverFirstName;
    onboarding.driverMiddleName = data.applicant?.middleName || onboarding.driverMiddleName;
    onboarding.driverLastName = data.applicant?.lastName || onboarding.driverLastName;
    onboarding.email = data.applicant?.email || onboarding.email;
    onboarding.phone = data.applicant?.phone || onboarding.phone;
    const application = await ensureApplication(onboarding);
    applyApplicantData(application, data.applicant);
    application.address = data.address || application.address;
    application.previousAddresses = data.previousAddresses || application.previousAddresses;
    application.metadata = metadataFromRequest(req);
    await application.save();
  }

  if (step === "employment-application") {
    const application = await ensureApplication(onboarding);
    application.companyInfo = data.companyInfo || application.companyInfo;
    applyApplicantData(application, data.applicant);
    application.license = { ...application.license?.toObject?.(), ...data.license };
    application.drivingExperience = data.drivingExperience || application.drivingExperience;
    application.metadata = metadataFromRequest(req);
    await application.save();
  }

  if (step === "safety-performance") {
    const application = await ensureApplication(onboarding);
    application.safetyPerformanceAcknowledgment = {
      ...application.safetyPerformanceAcknowledgment?.toObject?.(),
      ...data.safetyPerformanceAcknowledgment,
    };
    application.applicantCertification = {
      ...application.applicantCertification?.toObject?.(),
      ...data.applicantCertification,
    };
    application.metadata = metadataFromRequest(req);
    await application.save();
  }

  if (step === "accident-violation-history") {
    const application = await ensureApplication(onboarding);
    application.accidentsPast3Years = data.accidentsPast3Years || application.accidentsPast3Years;
    application.trafficConvictionsPast3Years =
      data.trafficConvictionsPast3Years || application.trafficConvictionsPast3Years;
    application.license.deniedSuspendedRevoked =
      data.deniedSuspendedRevoked ?? application.license.deniedSuspendedRevoked;
    application.license.deniedSuspendedRevokedExplanation =
      data.deniedSuspendedRevokedExplanation || application.license.deniedSuspendedRevokedExplanation;
    application.metadata = metadataFromRequest(req);
    await application.save();

    const violation = await ensureViolation(onboarding);
    violation.driverCertificationRows = data.driverCertificationRows || violation.driverCertificationRows;
    violation.noViolations = Boolean(data.noViolations);
    await violation.save();
  }

  if (step === "employment-history") {
    const application = await ensureApplication(onboarding);
    application.employmentHistory = data.employmentHistory || application.employmentHistory;
    application.cdlEmploymentHistoryRequired = Boolean(data.cdlEmploymentHistoryRequired || onboarding.configuration?.cdlRequired);
    application.cdlEmploymentHistory10Years =
      data.cdlEmploymentHistory10Years || application.cdlEmploymentHistory10Years;
    application.metadata = metadataFromRequest(req);
    await application.save();
  }

  if (step === "agreement") {
    const agreement = await ensureAgreement(onboarding);
    agreement.driverIdentity = data.driverIdentity || agreement.driverIdentity;
    agreement.effectiveDate = data.effectiveDate || agreement.effectiveDate || new Date();
    agreement.initials = data.initials || agreement.initials;
    agreement.acceptedSections = data.acceptedSections || agreement.acceptedSections;
    agreement.policyChecklistInitials = data.policyChecklistInitials || agreement.policyChecklistInitials;
    await agreement.save();
  }

  onboarding.currentStep = step;
  if (onboarding.status === "invited" || onboarding.status === "draft") onboarding.status = "in_progress";
  onboarding.missingDocuments = computeMissingDocuments(onboarding.requiredDocuments, onboarding.completedDocuments);
  await onboarding.save();
}

async function getPublicPayload(onboarding) {
  const [application, agreement, quiz, training, violation] = await Promise.all([
    DriverApplication.findOne({ onboardingId: onboarding._id }).lean(),
    IndependentContractorAgreementSubmission.findOne({ onboardingId: onboarding._id }).lean(),
    AgreementQuizAttempt.findOne({ onboardingId: onboarding._id }).lean(),
    TrainingAcknowledgment.findOne({ onboardingId: onboarding._id }).lean(),
    ViolationCertificationAnnualReview.findOne({ onboardingId: onboarding._id }).lean(),
  ]);

  const nextQuestion = nextQuizQuestion(quiz);
  const correctIds = new Set((quiz?.answers || []).filter((answer) => answer.correct).map((answer) => answer.questionId));

  const publicOnboarding = onboarding.toJSON ? onboarding.toJSON() : { ...onboarding };
  delete publicOnboarding.onboardingTokenHash;
  publicOnboarding.packetReadiness = computePacketReadiness(publicOnboarding);

  return {
    onboarding: publicOnboarding,
    steps: ENROLLME_STEPS,
    documentTemplates: DOCUMENT_TEMPLATE_DEFINITIONS,
    documents: { application, agreement, training, violation },
    quiz: {
      passed: Boolean(quiz?.passed),
      signed: Boolean(quiz?.driverSignature?.signedAt),
      score: quiz?.score || 0,
      attempts: quiz?.attempts || 0,
      answeredQuestionIds: [...correctIds],
      totalQuestions: AGREEMENT_QUIZ_QUESTIONS.length,
      nextQuestion: publicQuestion(nextQuestion),
      answers: quiz?.answers || [],
      wrongAnswers: quiz?.wrongAnswers || [],
      explanationsShown: quiz?.explanationsShown || [],
      completedAt: quiz?.completedAt,
      driverSignature: quiz?.driverSignature,
    },
  };
}

export async function getEnrollmeFormByToken(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    const firstOpen = !onboarding.tokenOpenedAt;
    if (firstOpen) onboarding.tokenOpenedAt = new Date();
    if (onboarding.status === "invited") onboarding.status = "in_progress";
    await onboarding.save();

    if (firstOpen) {
      await recordEnrollmeAudit({
        req,
        onboardingId: onboarding._id,
        actorType: "driver",
        actorLabel: onboarding.email,
        action: "token_opened",
      });
    }

    return res.status(200).json(await getPublicPayload(onboarding));
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to load onboarding form." });
  }
}

export async function saveEnrollmeStep(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    await applyStepData(req, onboarding, req.body.step, req.body.data);
    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "step_saved",
      metadata: { step: req.body.step },
    });
    return res.status(200).json({ message: "Step saved.", ...(await getPublicPayload(onboarding)) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to save step." });
  }
}

export async function submitEnrollmeStep(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    await applyStepData(req, onboarding, req.body.step, req.body.data);
    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "step_saved",
      metadata: { step: req.body.step },
    });
    return res.status(200).json({ message: "Step submitted.", ...(await getPublicPayload(onboarding)) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to submit step." });
  }
}

export async function reviewEnrollmeDocument(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    // API contract: the frontend sends the exact generated preview snapshot the driver reviewed.
    // A future backend renderer can replace this with a server-canonical snapshot before hashing.
    const reviewEvent = reviewEventFromBody(req, req.body);
    onboarding.documentReviewEvents.push(reviewEvent);
    await onboarding.save();

    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "document_previewed",
      documentType: req.body.documentType,
      metadata: { contentHash: req.body.contentHash, documentVersion: req.body.documentVersion },
    });
    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "document_review_confirmed",
      documentType: req.body.documentType,
      metadata: { reviewedAt: req.body.reviewedAt, contentHash: req.body.contentHash },
    });

    return res.status(200).json({ message: "Document review recorded.", review: reviewEvent });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to record document review." });
  }
}

export async function signEnrollmeDocument(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    const documentType = req.body.documentType;
    if (req.body.step) {
      await applyStepData(req, onboarding, req.body.step, req.body.data);
    }
    const signature = signatureFromBody(req, req.body, req.body.data?.documentVersion || AGREEMENT_VERSION);

    if (documentType === ENROLLME_DOCUMENT_TYPES.DRIVER_APPLICATION) {
      const application = await ensureApplication(onboarding);
      application.applicantSignature = signature;
      application.signedAt = signature.signedAt;
      if (req.body.data?.applicantCertification) {
        application.applicantCertification = {
          ...application.applicantCertification?.toObject?.(),
          ...req.body.data.applicantCertification,
        };
      }
      await application.save();
    } else if (documentType === ENROLLME_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT) {
      const agreement = await ensureAgreement(onboarding);
      agreement.driverSignature = signature;
      agreement.signedAt = signature.signedAt;
      agreement.effectiveDate = req.body.data?.effectiveDate || agreement.effectiveDate || new Date();
      agreement.acceptedSections = req.body.data?.acceptedSections || agreement.acceptedSections;
      agreement.initials = req.body.data?.initials || agreement.initials;
      agreement.policyChecklistInitials = req.body.data?.policyChecklistInitials || agreement.policyChecklistInitials;
      agreement.companySignaturePending = true;
      await agreement.save();
    } else if (documentType === ENROLLME_DOCUMENT_TYPES.VIOLATION_CERTIFICATION) {
      const violation = await ensureViolation(onboarding);
      violation.driverSignature = signature;
      violation.driverSignedAt = signature.signedAt;
      violation.driverCertificationRows = req.body.data?.driverCertificationRows || violation.driverCertificationRows;
      violation.noViolations = Boolean(req.body.data?.noViolations);
      await violation.save();
    } else if (documentType === ENROLLME_DOCUMENT_TYPES.AGREEMENT_QUIZ) {
      const quiz = await AgreementQuizAttempt.findOne({ onboardingId: onboarding._id });
      if (!quiz?.passed) {
        return res.status(400).json({ message: "Agreement quiz acknowledgment is locked until the quiz is complete." });
      }
      quiz.acknowledgmentText = req.body.acknowledgmentText;
      quiz.driverSignature = signature;
      quiz.signedAt = signature.signedAt;
      await quiz.save();
    } else if (documentType === ENROLLME_DOCUMENT_TYPES.WC43_REJECTION) {
      // TODO legal/compliance review: WC43 is conditional and should only be marked complete when it applies.
    } else {
      return res.status(400).json({ message: "Unsupported document signature type." });
    }

    const updated = await markOnboardingDocumentComplete(onboarding._id, documentType);
    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "document_signed",
      documentType,
      metadata: { contentHash: req.body.contentHash, reviewedAt: req.body.reviewedAt },
    });

    return res.status(200).json({ message: "Document signed.", ...(await getPublicPayload(updated)) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to sign document." });
  }
}

export async function answerEnrollmeQuizQuestion(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    const question = AGREEMENT_QUIZ_QUESTIONS.find((item) => item.id === req.body.questionId);
    if (!question) return res.status(404).json({ message: "Quiz question not found." });

    let attempt = await AgreementQuizAttempt.findOne({ onboardingId: onboarding._id });
    if (!attempt) {
      attempt = await AgreementQuizAttempt.create({
        onboardingId: onboarding._id,
        agreementVersion: AGREEMENT_VERSION,
        questions: AGREEMENT_QUIZ_QUESTIONS.map((item) => ({
          id: item.id,
          prompt: item.prompt,
          section: item.section,
        })),
      });
    }

    const correct = isCorrectAnswer(question, req.body.answer);
    attempt.attempts += 1;
    attempt.answers.push({
      questionId: question.id,
      answer: req.body.answer,
      correct,
      answeredAt: new Date(),
    });

    if (!correct) {
      const wrong = {
        questionId: question.id,
        answer: req.body.answer,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        section: question.section,
        answeredAt: new Date(),
      };
      attempt.wrongAnswers.push(wrong);
      attempt.explanationsShown.push({
        questionId: question.id,
        explanation: question.explanation,
        section: question.section,
        shownAt: new Date(),
      });
    }

    const correctIds = new Set(attempt.answers.filter((answer) => answer.correct).map((answer) => answer.questionId));
    attempt.score = Math.round((correctIds.size / AGREEMENT_QUIZ_QUESTIONS.length) * 100);
    attempt.passed = correctIds.size === AGREEMENT_QUIZ_QUESTIONS.length;
    if (attempt.passed && !attempt.completedAt) attempt.completedAt = new Date();
    await attempt.save();

    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "quiz_answered",
      documentType: ENROLLME_DOCUMENT_TYPES.AGREEMENT_QUIZ,
      metadata: { questionId: question.id, correct, explanationShown: !correct },
    });

    if (attempt.passed) {
      await recordEnrollmeAudit({
        req,
        onboardingId: onboarding._id,
        actorType: "driver",
        actorLabel: onboarding.email,
        action: "quiz_passed",
        documentType: ENROLLME_DOCUMENT_TYPES.AGREEMENT_QUIZ,
        metadata: { score: attempt.score, attempts: attempt.attempts },
      });
    }

    const nextQuestion = nextQuizQuestion(attempt);
    return res.status(200).json({
      correct,
      passed: attempt.passed,
      score: attempt.score,
      attempts: attempt.attempts,
      explanation: correct ? null : question.explanation,
      section: correct ? null : question.section,
      correctAnswer: correct ? null : question.correctAnswer,
      nextQuestion: publicQuestion(nextQuestion),
      answeredQuestionIds: [...correctIds],
      completedAt: attempt.completedAt,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to submit quiz answer." });
  }
}

export async function signTrainingAcknowledgment(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    const quiz = await AgreementQuizAttempt.findOne({ onboardingId: onboarding._id }).lean();
    if (!quiz?.passed) {
      return res.status(400).json({ message: "Training acknowledgment is locked until the agreement quiz is passed." });
    }
    if (!quiz?.driverSignature?.signedAt) {
      return res.status(400).json({ message: "Training acknowledgment is locked until the agreement quiz acknowledgment is signed." });
    }

    const signature = signatureFromBody(req, req.body, AGREEMENT_VERSION);
    const training = await TrainingAcknowledgment.findOneAndUpdate(
      { onboardingId: onboarding._id },
      {
        $set: {
          onboardingId: onboarding._id,
          acknowledgmentText: req.body.acknowledgmentText,
          confirmsReviewedAgreement: true,
          confirmsCompletedQuiz: true,
          confirmsReceivedTraining: true,
          confirmsPolicyReview: true,
          confirmsOpportunityForQuestions: true,
          driverSignature: signature,
          signedAt: signature.signedAt,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const updated = await markOnboardingDocumentComplete(onboarding._id, ENROLLME_DOCUMENT_TYPES.TRAINING_ACKNOWLEDGMENT);
    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: "training_acknowledged",
      documentType: ENROLLME_DOCUMENT_TYPES.TRAINING_ACKNOWLEDGMENT,
      metadata: { contentHash: req.body.contentHash, reviewedAt: req.body.reviewedAt },
    });

    return res.status(200).json({ message: "Training acknowledgment signed.", training, ...(await getPublicPayload(updated)) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to sign training acknowledgment." });
  }
}

export async function submitEnrollmeOnboarding(req, res) {
  try {
    const onboarding = await resolveOnboardingByToken(req.params.token);
    onboarding.missingDocuments = computeMissingDocuments(onboarding.requiredDocuments, onboarding.completedDocuments);
    if (onboarding.missingDocuments.length > 0) {
      await onboarding.save();
      return res.status(400).json({
        message: "Required documents are still missing.",
        missingDocuments: onboarding.missingDocuments,
      });
    }

    const wasCorrection = onboarding.status === "correction_requested";
    onboarding.status = nextStatusForReadiness(onboarding) || "driver_submitted";
    onboarding.submittedAt = new Date();
    await onboarding.save();
    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "driver",
      actorLabel: onboarding.email,
      action: wasCorrection ? "correction_resubmitted" : "driver_submitted",
    });

    return res.status(200).json({ message: "Onboarding submitted.", ...(await getPublicPayload(onboarding)) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to submit onboarding." });
  }
}
