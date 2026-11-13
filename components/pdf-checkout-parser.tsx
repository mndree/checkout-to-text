"use client";

import { useId, useRef, useState } from "react";
import {
  extractCheckoutReport,
  formatCheckoutReport,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  type CheckoutReport,
  type ExtractionProgress,
} from "@/lib/checkout-report";

type SelectedPdf = {
  file: File;
  pageCount: number | null;
};

function DocumentMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none">
        <path
          d="M15 6.75h12.5L38 17.25v23A2.75 2.75 0 0 1 35.25 43h-20.5A2.75 2.75 0 0 1 12 40.25V9.5a2.75 2.75 0 0 1 3-2.75Z"
          fill="currentColor"
        />
        <path d="M27 7v11h11" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M18 25h13M18 31h13M18 37h8" stroke="white" strokeWidth="2.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function PdfBadge() {
  return (
    <span className="pdf-badge" aria-hidden="true">
      <svg viewBox="0 0 44 52" fill="none">
        <path
          d="M8 2.5h18l15 15v28A4 4 0 0 1 37 49.5H8a4 4 0 0 1-4-4v-39a4 4 0 0 1 4-4Z"
          fill="white"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinejoin="round"
        />
        <path d="M26 3v15h14" stroke="currentColor" strokeWidth="2.7" strokeLinejoin="round" />
        <path d="M5 28h34v13H5z" fill="currentColor" />
        <text x="22" y="38" textAnchor="middle" fill="white" fontSize="10" fontWeight="800">
          PDF
        </text>
      </svg>
    </span>
  );
}

function FileIcon() {
  return (
    <svg className="file-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.75 3.75h7.1l5.4 5.4v11.1H6.75a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13.5 4v5.5H19" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M16 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v3h16v-3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatFileSize(size: number): string {
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export default function PdfCheckoutParser() {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPdf, setSelectedPdf] = useState<SelectedPdf | null>(null);
  const [fileError, setFileError] = useState("");
  const [processError, setProcessError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [report, setReport] = useState<CheckoutReport | null>(null);
  const [output, setOutput] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  async function selectFile(file: File | undefined) {
    if (!file || isProcessing) {
      return;
    }
    setFileError("");
    setProcessError("");
    setCopyMessage("");
    setReport(null);
    setOutput("");
    setProgress(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSelectedPdf(null);
      setFileError("Ukuran file melebihi batas " + MAX_FILE_SIZE_MB + " MB.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setSelectedPdf(null);
      setFileError("Pilih file dengan format PDF.");
      return;
    }

    const signature = await file.slice(0, 1024).text().catch(() => "");
    if (!signature.includes("%PDF-")) {
      setSelectedPdf(null);
      setFileError("File ini bukan PDF yang valid. Pilih file PDF lain.");
      return;
    }

    setSelectedPdf({ file, pageCount: null });
  }

  function clearSelectedFile() {
    setSelectedPdf(null);
    setFileError("");
    setProcessError("");
    setProgress(null);
    setReport(null);
    setOutput("");
    setCopyMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function processPdf() {
    if (!selectedPdf || isProcessing) {
      return;
    }

    setIsProcessing(true);
    setProcessError("");
    setProgress({
      page: 0,
      totalPages: 0,
      message: "Membuka PDF di browser...",
    });
    setReport(null);
    setOutput("");
    setCopyMessage("");

    try {
      const extracted = await extractCheckoutReport(selectedPdf.file, (nextProgress) => {
        setProgress(nextProgress);
        if (nextProgress.totalPages > 0) {
          setSelectedPdf((current) =>
            current ? { ...current, pageCount: nextProgress.totalPages } : current,
          );
        }
      });
      setReport(extracted);
      setOutput(formatCheckoutReport(extracted));
    } catch (error) {
      setProcessError(
        error instanceof Error
          ? error.message
          : "PDF tidak dapat diproses. Silakan coba file lain.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function copyText() {
    if (!output.trim()) {
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(output);
      } else {
        const temporary = document.createElement("textarea");
        temporary.value = output;
        temporary.setAttribute("readonly", "");
        temporary.style.position = "fixed";
        temporary.style.opacity = "0";
        document.body.appendChild(temporary);
        temporary.select();
        document.execCommand("copy");
        temporary.remove();
      }
      setCopyMessage("Teks berhasil disalin.");
    } catch {
      setCopyMessage("Teks tidak dapat disalin. Pilih dan salin teks secara manual.");
    }
  }

  function downloadText() {
    if (!output.trim()) {
      return;
    }
    const sourceName = selectedPdf?.file.name.replace(/\.pdf$/i, "") || "laporan-check-out";
    const safeName =
      sourceName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-") || "laporan-check-out";
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName + ".txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isProcessing) {
      return;
    }
    const droppedFile = event.dataTransfer.files?.[0];
    void selectFile(droppedFile);
  }

  function handleBrowseKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isProcessing && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  const resultCount = report?.sections.length || 0;
  const reviewCount = report?.reviewFlags.length || 0;

  return (
    <main className="page-shell">
      <header className="page-heading">
        <DocumentMark />
        <h1>PDF Check-Out Parser</h1>
        <p>Upload laporan PDF dan ubah menjadi teks terstruktur.</p>
      </header>

      <section className="panel upload-panel" aria-labelledby="file-heading">
        <h2 id="file-heading" className="panel-title">
          File PDF
        </h2>

        <div
          className={isDragging ? "dropzone dropzone-active" : "dropzone"}
          role="button"
          tabIndex={0}
          aria-disabled={isProcessing}
          aria-label="Pilih file PDF atau tarik file ke sini"
          onClick={() => {
            if (!isProcessing) {
              fileInputRef.current?.click();
            }
          }}
          onKeyDown={handleBrowseKeyDown}
          onDragOver={(event) => {
            event.preventDefault();
            if (!isProcessing) {
              setIsDragging(true);
            }
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            id={fileInputId}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            tabIndex={-1}
            disabled={isProcessing}
            aria-label="Pilih file PDF"
            onChange={(event) => {
              void selectFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <PdfBadge />
          <span className="dropzone-divider" />
          <span className="dropzone-copy">
            <strong>{selectedPdf ? "Pilih PDF lain atau tarik file ke sini" : "Pilih file PDF atau tarik file ke sini"}</strong>
            <span>PDF hingga {MAX_FILE_SIZE_MB} MB · diproses di perangkat Anda</span>
          </span>
        </div>

        {selectedPdf ? (
          <div className="file-summary">
            <div className="file-summary-info">
              <FileIcon />
              <div className="file-summary-copy">
                <strong title={selectedPdf.file.name}>{selectedPdf.file.name}</strong>
                <span>
                  {formatFileSize(selectedPdf.file.size)}
                  {selectedPdf.pageCount
                    ? " · " + selectedPdf.pageCount + " halaman"
                    : " · jumlah halaman dibaca saat diproses"}
                </span>
              </div>
            </div>
            <div className="file-summary-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                Ganti file
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={clearSelectedFile}
                disabled={isProcessing}
              >
                Hapus
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={processPdf}
                disabled={isProcessing}
              >
                {isProcessing ? "Memproses..." : "Proses PDF"}
              </button>
            </div>
          </div>
        ) : (
          <div className="upload-footer">
            <span className="muted-hint">File PDF maksimal {MAX_FILE_SIZE_MB} MB</span>
            <button className="button button-primary" type="button" disabled>
              Proses PDF
            </button>
          </div>
        )}

        {fileError ? (
          <p className="message message-error" role="alert">
            {fileError}
          </p>
        ) : null}
        {processError ? (
          <p className="message message-error" role="alert">
            {processError}
          </p>
        ) : null}
        {isProcessing && progress ? (
          <div className="progress-panel" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div className="progress-copy">
              <strong>{progress.message}</strong>
              {progress.totalPages > 0 ? (
                <div
                  className="progress-track"
                  aria-label={
                    "Memproses halaman " + progress.page + " dari " + progress.totalPages
                  }
                >
                  <span
                    style={{
                      width:
                        Math.max(
                          4,
                          Math.round((progress.page / progress.totalPages) * 100),
                        ) + "%",
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel result-panel" aria-labelledby="result-heading">
        <div className="result-heading-row">
          <div className="result-title-wrap">
            <h2 id="result-heading" className="panel-title">
              Hasil teks
            </h2>
            {report ? (
              <span className="result-count">
                {resultCount} bagian · {report.pageCount} halaman
              </span>
            ) : null}
          </div>
          <div className="result-actions">
            <button
              className="button button-outline"
              type="button"
              onClick={copyText}
              disabled={!output.trim()}
            >
              <CopyIcon />
              Salin teks
            </button>
            <button
              className="button button-outline"
              type="button"
              onClick={downloadText}
              disabled={!output.trim()}
            >
              <DownloadIcon />
              Unduh .txt
            </button>
          </div>
        </div>

        {report && reviewCount > 0 ? (
          <div className="review-callout" role="status">
            <strong>Perlu ditinjau</strong>
            <span>
              {reviewCount} bagian belum terbaca dengan yakin. Pastikan isi teks sudah benar
              sebelum digunakan.
            </span>
            <ul>
              {report.reviewFlags.slice(0, 3).map((flag) => (
                <li key={flag.id}>
                  {flag.page ? "Halaman " + flag.page + ": " : ""}
                  {flag.message}
                </li>
              ))}
              {reviewCount > 3 ? <li>Dan {reviewCount - 3} bagian lainnya.</li> : null}
            </ul>
          </div>
        ) : null}

        <label className="visually-hidden" htmlFor="checkout-output">
          Hasil teks yang dapat diedit
        </label>
        <textarea
          id="checkout-output"
          className="output-textarea"
          value={output}
          onChange={(event) => setOutput(event.currentTarget.value)}
          placeholder="Hasil teks akan muncul di sini setelah PDF diproses. Anda dapat mengedit hasilnya sebelum menyalin atau mengunduh."
          spellCheck={false}
        />
        <div className="result-footer">
          <p>
            Sel catatan yang kosong ditampilkan sebagai <code>(Kosong)</code>. Dokumentasi foto
            diabaikan.
          </p>
          <p className="copy-message" aria-live="polite">
            {copyMessage}
          </p>
        </div>
      </section>

      <p className="privacy-note">
        PDF dan hasil ekstraksi diproses di browser Anda. File tidak dikirim atau disimpan ke server.
      </p>
    </main>
  );
}
