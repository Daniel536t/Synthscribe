import { Link, useLocation } from "wouter";
import { Music, Mic, Library, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/60 backdrop-blur-xl">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group" data-testid="link-home">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform duration-300">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-bold text-xl tracking-tight text-gradient">
            SynthScribe
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link href="/" data-testid="link-nav-create">
            <Button 
              variant={location === "/" ? "secondary" : "ghost"} 
              size="sm" 
              className="rounded-full font-medium"
            >
              <Mic className="w-4 h-4 mr-2" />
              Studio
            </Button>
          </Link>
          <Link href="/projects" data-testid="link-nav-library">
            <Button 
              variant={location === "/projects" ? "secondary" : "ghost"} 
              size="sm" 
              className="rounded-full font-medium"
            >
              <Library className="w-4 h-4 mr-2" />
              Library
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}
