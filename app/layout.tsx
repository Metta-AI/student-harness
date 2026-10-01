import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Softmax IDE Beta",
  description: "Build, upload, and play a Gods of the Arena policy with the Neural Viking Agent",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
