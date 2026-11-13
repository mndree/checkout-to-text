import type { Metadata } from "next";
import "./globals.css";

const description =
  "Ubah laporan check-out apartemen PDF menjadi teks terstruktur yang bisa diedit. Ekstraksi dan OCR berjalan di browser.";

export const metadata: Metadata = {
  title: {
    default: "PDF Check-Out Parser",
    template: "%s | PDF Check-Out Parser",
  },
  applicationName: "PDF Check-Out Parser",
  description,
  keywords: [
    "PDF check-out",
    "laporan check-out apartemen",
    "ekstraksi PDF",
    "OCR",
    "teks terstruktur",
  ],
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "PDF Check-Out Parser",
    title: "PDF Check-Out Parser",
    description,
  },
  twitter: {
    card: "summary",
    title: "PDF Check-Out Parser",
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
