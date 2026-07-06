import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Sans + display: one grotesque, matching carmen-platform.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Data: IDs, timestamps, byte sizes, SQL. Kept from the prior design.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Carmen · God Mode",
  description: "Admin console for inspecting and surgically mutating Carmen inventory data.",
};

// Apply the dark class before paint to avoid a flash of the wrong theme.
// Honours a stored localStorage["theme"] choice (light/dark/system), falling
// back to prefers-color-scheme when unset or set to "system".
const themeScript = `
(function () {
  try {
    var pref = localStorage.getItem("theme");
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = pref === "dark" || ((pref === "system" || !pref) && systemDark);
    if (dark) document.documentElement.classList.add("dark");
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
      className={`${inter.variable} ${plexMono.variable} h-full antialiased`}
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
