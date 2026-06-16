import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptSonar",
  description: "See where AI instructions can go before production.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
