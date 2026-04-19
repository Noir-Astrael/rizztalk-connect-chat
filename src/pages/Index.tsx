import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Pillars } from "@/components/Pillars";
import { Anonymity } from "@/components/Anonymity";
import { Architecture } from "@/components/Architecture";
import { Trust } from "@/components/Trust";
import { Roadmap } from "@/components/Roadmap";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";

const Index = () => {
  return (
    <main className="min-h-screen">
      <Navbar />
      <h1 className="sr-only">Rizztalk — Random Chat Anonim Indonesia</h1>
      <Hero />
      <Pillars />
      <Anonymity />
      <Architecture />
      <Trust />
      <Roadmap />
      <CTA />
      <Footer />
    </main>
  );
};

export default Index;
