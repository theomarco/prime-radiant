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

const TAGLINE = "You have the past and the present. Find out what comes next.";
const BLURB =
  "Bring the table as it is. Point at the column you are missing. No training run, no feature engineering.";

export const metadata: Metadata = {
  // Without this, Next emits a relative og:image path and crawlers that require
  // an absolute URL fall back to no image at all.
  metadataBase: new URL("https://prime-radiant-chi.vercel.app"),
  title: "Prime Radiant",
  description: `${TAGLINE} ${BLURB}`,
  openGraph: {
    title: "Prime Radiant",
    description: TAGLINE,
    type: "website",
    siteName: "Prime Radiant",
    url: "/",
  },
  twitter: {
    // "summary" gives the small thumbnail card; this is the wide one.
    card: "summary_large_image",
    title: "Prime Radiant",
    description: TAGLINE,
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
            {/* The mark is the link; the words are not. Padding is pulled back by
                the negative margin so a 12px glyph still gets a 24px hit area
                without shifting the baseline. */}
            <p className="flex items-center gap-2.5 font-mono text-[0.6875rem] tracking-wider uppercase">
              Follow the progress
              <a
                href="https://x.com/theomarcolini"
                target="_blank"
                rel="noreferrer"
                aria-label="Follow Theo Marcolini on X"
                title="Follow Theo Marcolini on X"
                className="-m-1.5 inline-flex p-1.5 text-muted transition-colors hover:text-ink"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
