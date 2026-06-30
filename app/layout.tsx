import type { Metadata } from "next";
import { Geist, Geist_Mono, Martian_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face: a mono grotesque used with restraint for the wordmark,
// eyebrows, page titles and numeric readouts — the instrument-console voice.
const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Carmen God Mode",
  description: "Admin console for inspecting and surgically mutating Carmen inventory data.",
};

// Apply the dark class before paint to avoid a flash of the wrong theme.
// Respects prefers-color-scheme; no manual toggle (per plan, no extra dep).
const themeScript = `
(function () {
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${martianMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
