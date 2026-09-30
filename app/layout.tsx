import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "NeuralHub Arena",
  description: "Build and play Gods of the Arena from your browser",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
