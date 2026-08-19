import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Prime Radiant",
  description:
    "By 2028, data science will be something you do, not someone you hire. Upload a table, pick a column, get predictions.",
  openGraph: {
    title: "Prime Radiant",
    description:
      "By 2028, data science will be something you do, not someone you hire.",
    type: "website",
  },
};

const NAV = [
  { href: "/", label: "Manifesto" },
  { href: "/predict", label: "Predict" },
  { href: "/board", label: "Board" },
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="ambient" aria-hidden />

        <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
          <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
            <Link href="/" className="eyebrow !text-ink hover:!text-muted transition-colors">
              Prime Radiant
            </Link>
            <div className="flex items-center gap-7">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-[0.8125rem] text-ink-soft transition-colors hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
              <a
                href="https://github.com/theomarco/prime-radiant"
                target="_blank"
                rel="noreferrer"
                className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
              >
                Source
              </a>
            </div>
          </nav>
        </header>

        <main className="relative z-10 flex-1">{children}</main>

        <footer className="relative z-10 border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-10 text-[0.8125rem] text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Built in public on{" "}
              <a
                href="https://www.neuralk.ai"
                target="_blank"
                rel="noreferrer"
                className="text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
              >
                Seldon
              </a>
              , a tabular foundation model.
            </p>
            <p className="font-mono text-[0.6875rem] tracking-wider uppercase">
              <a
                href="https://x.com/theomarcolini"
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink"
              >
                Follow the progress
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
