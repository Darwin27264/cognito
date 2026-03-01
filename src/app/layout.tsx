import type { Metadata } from "next";
import { Geist, Roboto_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "COGNITO // Events Dashboard",
  description:
    "Real-time geopolitical events dashboard — conflict tracking, commodity surveillance, and strategic news aggregation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${robotoMono.variable} antialiased bg-tactical-black text-text-primary`}
      >
        {children}
      </body>
    </html>
  );
}
