# PDF Check-Out Parser

A browser-first Next.js app that turns apartment check-out report PDFs into editable, consistently formatted Indonesian text.

## Run locally

Use Node.js 20.9 or newer. In PowerShell, from the project directory, run:

    npm.cmd install
    npm.cmd run dev

On macOS or Linux, use npm install and npm run dev.

Open http://localhost:3000.

The 20 MB file limit is configured by MAX_FILE_SIZE_MB in lib/checkout-report.ts. No environment variables or database are required.
PDF files are excluded from Git and Vercel uploads by default, so the supplied report stays local.

## Deploy to Vercel

1. Push this project to a Git repository.
2. Import the repository into Vercel and keep the detected Next.js settings.
3. Use Node.js 22 or newer in the project settings.
4. Deploy. No environment variables are needed.

The Vercel Hobby plan is intended for eligible personal, noncommercial projects. Confirm the current plan terms for your intended use before deploying.

## PDF handling

PDF.js reads selectable text and its positions in the browser. Pages without a usable text layer are rendered locally and passed to Tesseract.js in a browser worker. OCR can take longer on scanned or large reports. Tesseract downloads its worker and Indonesian/English language data on demand; the PDF itself is not uploaded. OCR can misread low-resolution text, handwritten notes, or unusual table layouts, so review the flagged fields and edit the text before using it.

Empty note cells are formatted as (Kosong). Documentation images and image counts are ignored. The textarea is editable, and copying or downloading uses its current content.
