import { useGetProjectStatus, useGetProject, getGetProjectQueryKey, getGetProjectStatusQueryKey } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Loader2, CheckCircle2, AlertCircle, Sparkles, Download, Play, Pause, Mic, Waves, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import Resonance from "@/components/Resonance";
import { audioReactive } from "@/lib/audioReactive";

export default function Project() {
  const [, params] = useRoute("/projects/:id");
  const id = params?.id;

  const { data: project } = useGetProject(id!, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id!) }
  });

  const isFinished = project?.stage === "complete" || project?.stage === "error";

  const { data: status } = useGetProjectStatus(id!, {
    query: {
      enabled: !!id && !isFinished,
      refetchInterval: 1500,
      queryKey: getGetProjectStatusQueryKey(id!)
    }
  });

  const [activeAudio, setActiveAudio] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentStage = status?.stage || project?.stage || "draft";
  const progress = status?.progress || project?.progress || 0;
  const message = status?.message || "Warming up the studio...";
  const errorMsg = status?.error || project?.error;
  const audioUrls = status?.audio || project?.audio;

  const startElementAnalyser = () => {
    if (audioRef.current) {
      audioReactive.connectElement(audioRef.current);
    }
  };

  // Release the shared analyser when leaving the page so it doesn't stay
  // "active" and suppress idle breathing on the next screen.
  useEffect(() => {
    return () => {
      audioReactive.stop();
    };
  }, []);

  const playAudio = (url: string | null) => {
    if (!url || !audioRef.current) return;
    const el = audioRef.current;
    el.crossOrigin = "anonymous";
    if (activeAudio === url) {
      if (el.paused) {
        startElementAnalyser();
        el.play();
      } else {
        el.pause();
      }
    } else {
      el.src = url;
      startElementAnalyser();
      el.play();
      setActiveAudio(url);
    }
  };

  const stages = [
    { key: "draft", label: "Draft" },
    { key: "transcribing", label: "Transcribing Melody" },
    { key: "generating_backing", label: "Producing Your Track" },
    { key: "singing", label: "Singing Your Lyrics" },
    { key: "mixing", label: "Finishing the Master" },
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
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          audioReactive.stop();
        }}
        onEnded={() => {
          setIsPlaying(false);
          setActiveAudio(null);
          audioReactive.stop();
        }}
      />
      
      <div className="mb-12 text-center space-y-4">
        <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-widest text-sm mb-4">
          {project?.vibe} Vibe
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">{project?.title}</h1>
        {project?.theme && (
          <p className="text-lg text-muted-foreground font-medium max-w-2xl mx-auto" data-testid="text-theme">
            “{project.theme}”
          </p>
        )}
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

            <div className="mx-auto mb-8 h-56 w-56">
              <Resonance vibe={project?.vibe} mode={isPlaying ? "playing" : "idle"} className="h-full w-full" />
            </div>

            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
              <Button 
                size="icon" 
                className="w-24 h-24 rounded-full shadow-2xl shadow-primary/40 hover:scale-105 transition-transform shrink-0"
                onClick={() => playAudio(audioUrls?.final || null)}
                disabled={!audioUrls?.final}
                data-testid="button-play-final"
              >
                {isPlaying && activeAudio === audioUrls?.final ? (
                  <Pause className="w-10 h-10" />
                ) : (
                  <Play className="w-10 h-10 ml-2" />
                )}
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
                  {project?.length && (
                    <div className="px-4 py-2 rounded-xl bg-background/50 backdrop-blur font-mono font-bold flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="capitalize text-primary">{project.length}</span>
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

          {/* Lyrics */}
          {project?.lyrics && (
            <div>
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Waves className="w-6 h-6 text-primary" />
                The Lyrics
              </h3>
              <Card className="bg-card/50 backdrop-blur border-none">
                <CardContent className="p-8">
                  <p className="whitespace-pre-wrap text-lg leading-relaxed font-medium text-foreground/90" data-testid="text-lyrics">
                    {project.lyrics}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Original hum seed */}
          <div>
            <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary" />
              Your Original Hum
            </h3>
            <p className="text-muted-foreground mb-6 font-medium">
              The hum you recorded set the key and tempo of this song. Here it is, kept as a keepsake.
            </p>
            <Card className="bg-card/50 backdrop-blur border-none hover:bg-card transition-colors max-w-sm">
              <CardContent className="p-6 flex flex-col items-center text-center gap-4">
                <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-blue-500">
                  <Mic />
                </div>
                <h4 className="font-bold">Original Hum</h4>
                <Button
                  variant="outline"
                  className="w-full rounded-xl"
                  disabled={!audioUrls?.hum}
                  onClick={() => playAudio(audioUrls?.hum || null)}
                  data-testid="button-play-hum"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Listen
                </Button>
              </CardContent>
            </Card>
          </div>

        </div>
      ) : (
        <div className="max-w-2xl mx-auto space-y-12">
          <div className="text-center space-y-6">
            <div className="mx-auto h-48 w-48">
              <Resonance vibe={project?.vibe} mode="idle" className="h-full w-full" />
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
