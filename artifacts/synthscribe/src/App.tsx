import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Project from "@/pages/Project";
import Library from "@/pages/Library";
import Navbar from "@/components/layout/Navbar";
import SceneBackdrop from "@/components/SceneBackdrop";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="relative min-h-[100dvh] flex flex-col">
      <SceneBackdrop />
      <Navbar />
      <main className="relative z-10 flex-1 flex flex-col">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/projects" component={Library} />
          <Route path="/projects/:id" component={Project} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
