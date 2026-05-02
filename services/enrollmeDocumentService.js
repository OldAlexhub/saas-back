import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DOCUMENT_TEMPLATE_DEFINITIONS } from "../constants/enrollme.js";
import DocumentTemplate from "../models/enrollme/DocumentTemplate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.resolve(__dirname, "../../enrollme/src/assets");

export function getEnrollmeAssetsRoot() {
  return assetsRoot;
}

export function resolveTemplateAssetPath(template) {
  const absolutePath = path.resolve(assetsRoot, template.originalFilePath);
  if (!absolutePath.startsWith(assetsRoot)) {
    throw new Error("Invalid document template path.");
  }
  return absolutePath;
}

export async function ensureDocumentTemplates() {
  const templates = [];
  for (const definition of DOCUMENT_TEMPLATE_DEFINITIONS) {
    const template = await DocumentTemplate.findOneAndUpdate(
      { documentType: definition.documentType },
      { $set: { ...definition, active: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    templates.push(template);
  }
  return templates;
}

export async function getDocumentTemplate(documentType) {
  await ensureDocumentTemplates();
  return DocumentTemplate.findOne({ documentType, active: true }).lean();
}

export async function assertTemplateFile(documentType) {
  const template = await getDocumentTemplate(documentType);
  if (!template) {
    const err = new Error("Document template not found.");
    err.statusCode = 404;
    throw err;
  }

  const absolutePath = resolveTemplateAssetPath(template);
  if (!fs.existsSync(absolutePath)) {
    const err = new Error("Document template file is missing.");
    err.statusCode = 404;
    throw err;
  }

  return { template, absolutePath };
}
