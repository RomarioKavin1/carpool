/**
 * The document shell, and the one place the two type families are loaded.
 *
 * They used to be loaded inside `app/page.tsx` and scoped to the explainer, with
 * `/app` left on the system stack. That is most of why the two routes read as two
 * different products: same palette, different voice. The user's instruction was
 * the opposite — the landing's type was approved and everything else should
 * carry it — so both faces are injected on `<html>` here and
 * `tailwind.config.ts` maps `font-sans` and `font-mono` onto them.
 *
 * ## The two fonts, and the procedure that chose them
 *
 * Three brand-voice words, written as physical objects rather than adjectives:
 * **stamped, mechanical, unhurried.** The object is a municipal meter faceplate,
 * or the date-due card stamped inside a library book: things whose entire purpose
 * is to say that something expires and that somebody paid.
 *
 * Reflex picks, listed and rejected: Inter and Space Grotesk (both on the
 * reflex-reject list), and JetBrains Mono, which is not on the list but is the
 * developer-mono reflex and would read as costume rather than as instrument.
 *
 * What the catalogue gave instead:
 *
 * - **Archivo** (Omnibus-Type), drawn from nineteenth-century American grotesques
 *   for signage and small sizes, with a width axis. It is a working UI grotesque
 *   at 12–16px and a signage face at 46px, which is exactly what a page that is
 *   half explainer and half dense table needs from one family.
 * - **Martian Mono** (Evil Martian), a wide semi-monospace drawn for technical
 *   readouts rather than for code. It carries every number on both routes.
 *
 * Cross-check: neither is the reflex, neither is on the reject list, and the pair
 * is a signage-and-instrument pairing rather than the sans-plus-display-serif
 * shape the editorial lane would have produced.
 *
 * Both are self-hosted by `next/font` at build time, so neither route makes a
 * request to a font CDN at runtime, and both stacks fall back to installed faces
 * so every page is legible before and without them.
 *
 * The product register warns against display faces in UI labels, and this is not
 * that: Archivo is a grotesque drawn for small sizes, and Martian Mono ships
 * tabular figures. What is borrowed from the reference is the TRACKING, which
 * `tailwind.config.ts` sets per step, not a decorative face.
 */
import type { Metadata } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-display",
});

const plate = Martian_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plate",
});

export const metadata: Metadata = {
  title: "Carpool: buy the research instead of redoing it",
  description:
    "An agent about to spend twenty minutes researching something checks whether somebody already did it, and buys that instead. Live from a Carpool registry: what is on sale, what it costs right now, and which author got paid.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${plate.variable}`}>
      <body className="bg-field font-sans text-base text-ink antialiased">{children}</body>
    </html>
  );
}
