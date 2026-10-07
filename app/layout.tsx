import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Softmax · Preston",
  description: "Develop game policies with Preston. Test ideas, review replays, and improve together.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
