import { useGetProjectStatus, useGetProject, ProjectStatus } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Loader2, Music, CheckCircle2, AlertCircle, Sparkles, Download, Play, Mic, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";

export default function Project() {
  const [, params] = useRoute("/projects/:id");
  const id = params?.id;

  const { data: project } = useGetProject(id!, {
    query: { enabled: !!id }
  });

  const isFinished = project?.stage === "complete" || project?.stage === "error";

  const { data: status } = useGetProjectStatus(id!, {
    query: { 
      enabled: !!id && !isFinished,
      refetchInterval: 1500
    }
  });

  const [activeAudio, setActiveAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentStage = status?.stage || project?.stage || "draft";
  const progress = status?.progress || project?.progress || 0;
  const message = status?.message || "Warming up the studio...";
  const errorMsg = status?.error || project?.error;
  const audioUrls = status?.audio || project?.audio;

  const playAudio = (url: string | null) => {
    if (!url) return;
    if (activeAudio === url && audioRef.current) {
      if (audioRef.current.paused) audioRef.current.play();
      else audioRef.current.pause();
    } else {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
      }
      setActiveAudio(url);
    }
  };

  const stages = [
    { key: "draft", label: "Draft" },
    { key: "transcribing", label: "Transcribing Melody" },
    { key: "generating_backing", label: "Generating Backing Track" },
    { key: "singing", label: "Synthesizing Vocals" },
    { key: "mixing", label: "Final Mix & Master" },
    { key: "complete", label: "Complete" }
  ];

  const currentStageIndex = stages.findIndex(s => s.key === currentStage);

  if (!project && !status) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <audio ref={audioRef} onEnded={() => setActiveAudio(null)} />
      
      <div className="mb-12 text-center space-y-4">
        <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-widest text-sm mb-4">
          {project?.vibe} Vibe
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">{project?.title}</h1>
      </div>

      {currentStage === "error" ? (
        <div className="p-8 rounded-3xl bg-destructive/10 border border-destructive/20 text-center space-y-4">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto" />
          <h2 className="text-2xl font-bold text-destructive">Production Failed</h2>
          <p className="text-muted-foreground">{errorMsg || "An unknown error occurred during generation."}</p>
        </div>
      ) : currentStage === "complete" ? (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
          
          {/* Main Player */}
          <div className="p-8 md:p-12 rounded-[2.5rem] glass-panel relative overflow-hidden group">
            <div className="absolute -inset-20 bg-gradient-to-br from-primary/20 via-secondary/20 to-accent/20 blur-3xl -z-10 opacity-50 group-hover:opacity-100 transition-opacity duration-1000" />
            
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
              <Button 
                size="icon" 
                className="w-24 h-24 rounded-full shadow-2xl shadow-primary/40 hover:scale-105 transition-transform shrink-0"
                onClick={() => playAudio(audioUrls?.final || null)}
                disabled={!audioUrls?.final}
                data-testid="button-play-final"
              >
                <Play className="w-10 h-10 ml-2" />
              </Button>
              
              <div className="flex-1 space-y-6 text-center md:text-left">
                <div>
                  <h3 className="text-3xl font-bold text-gradient mb-2">Final Master</h3>
                  <p className="text-lg text-muted-foreground font-medium">Ready to share with the world.</p>
                </div>
                
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4">
                  {project?.key && (
                    <div className="px-4 py-2 rounded-xl bg-background/50 backdrop-blur font-mono font-bold">
                      Key: <span className="text-primary">{project.key}</span>
                    </div>
                  )}
                  {project?.tempo && (
                    <div className="px-4 py-2 rounded-xl bg-background/50 backdrop-blur font-mono font-bold">
                      Tempo: <span className="text-secondary">{project.tempo} BPM</span>
                    </div>
                  )}
                  {project?.durationSeconds && (
                    <div className="px-4 py-2 rounded-xl bg-background/50 backdrop-blur font-mono font-bold">
                      Duration: <span className="text-accent">{Math.floor(project.durationSeconds / 60)}:{(project.durationSeconds % 60).toString().padStart(2, '0')}</span>
                    </div>
                  )}
                </div>
              </div>
              
              <Button 
                size="lg" 
                variant="secondary"
                className="rounded-2xl shrink-0 h-14 px-8 font-bold"
                onClick={() => {
                  if (audioUrls?.final) {
                    const a = document.createElement('a');
                    a.href = audioUrls.final;
                    a.download = `${project?.title || 'song'}.wav`;
                    a.click();
                  }
                }}
                disabled={!audioUrls?.final}
              >
                <Download className="w-5 h-5 mr-2" />
                Download Song
              </Button>
            </div>
          </div>

          {/* Stems */}
          <div>
            <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary" />
              The Stems
            </h3>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { title: "Original Hum", icon: <Mic />, url: audioUrls?.hum, color: "text-blue-500" },
                { title: "Backing Track", icon: <Music />, url: audioUrls?.backing, color: "text-purple-500" },
                { title: "Vocals", icon: <Waves />, url: audioUrls?.vocals, color: "text-pink-500" },
              ].map((stem, i) => (
                <Card key={i} className="bg-card/50 backdrop-blur border-none hover:bg-card transition-colors">
                  <CardContent className="p-6 flex flex-col items-center text-center gap-4">
                    <div className={`w-12 h-12 rounded-full bg-background flex items-center justify-center ${stem.color}`}>
                      {stem.icon}
                    </div>
                    <h4 className="font-bold">{stem.title}</h4>
                    <Button 
                      variant="outline" 
                      className="w-full rounded-xl"
                      disabled={!stem.url}
                      onClick={() => playAudio(stem.url || null)}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Listen
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

        </div>
      ) : (
        <div className="max-w-2xl mx-auto space-y-12">
          <div className="text-center space-y-6">
            <div className="relative w-32 h-32 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-[spin_4s_linear_infinite]" />
              <div className="absolute inset-2 border-4 border-t-primary rounded-full animate-[spin_2s_linear_infinite]" />
              <Sparkles className="w-12 h-12 text-primary animate-pulse" />
            </div>
            
            <h2 className="text-3xl font-bold animate-pulse text-gradient">{message}</h2>
          </div>

          <div className="space-y-6 p-8 rounded-3xl glass-panel">
            <div className="flex justify-between text-sm font-bold font-mono">
              <span className="text-primary">Generation Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-4 rounded-full bg-background" />
            
            <div className="space-y-4 mt-8">
              {stages.slice(1, -1).map((stage, index) => {
                const stepIndex = index + 1;
                const isPast = currentStageIndex > stepIndex;
                const isCurrent = currentStageIndex === stepIndex;
                
                return (
                  <div key={stage.key} className={`flex items-center gap-4 transition-all duration-500 ${isPast ? 'opacity-50' : isCurrent ? 'scale-105 font-bold' : 'opacity-30'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isPast ? 'bg-primary text-primary-foreground' : isCurrent ? 'bg-primary text-primary-foreground animate-pulse' : 'bg-muted text-muted-foreground'}`}>
                      {isPast ? <CheckCircle2 className="w-5 h-5" /> : stepIndex}
                    </div>
                    <span className="text-lg">{stage.label}</span>
                    {isCurrent && <Loader2 className="w-4 h-4 animate-spin ml-auto text-primary" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
