import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "../components/navigation/site-nav";

export const metadata: Metadata = {
  title: "Softmax IDE",
  description: "Develop game policies with Preston. Test ideas, review replays, and improve together.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><SiteNav />{children}</body></html>;
}
