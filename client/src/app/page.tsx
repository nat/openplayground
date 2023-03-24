import Image from "next/image";
import { Inter } from "next/font/google";
import LegacyApp from "@/components/legacy-app";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <main>
      <LegacyApp />
    </main>
  );
}
