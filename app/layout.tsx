import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Check-Out Parser",
  description: "Ubah laporan check-out apartemen PDF menjadi teks yang mudah diedit.",
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
