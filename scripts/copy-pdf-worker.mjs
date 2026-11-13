import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs");
const publicDirectory = resolve(root, "public");
const destination = resolve(publicDirectory, "pdf.worker.mjs");

await mkdir(publicDirectory, { recursive: true });
await copyFile(source, destination);
console.log("Prepared the PDF.js browser worker.");
