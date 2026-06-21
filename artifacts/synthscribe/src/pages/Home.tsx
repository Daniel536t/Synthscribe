import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Vibe } from "@workspace/api-client-react";
import { useCreateProject, useUploadHum, useStartGeneration, useListProjects } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { Music, Sparkles, Wand2, Loader2, Headphones, Flower2, Heart, Piano, Guitar, Drum, Radio, Clock, Mic2 } from "lucide-react";
import AudioRecorder from "@/components/AudioRecorder";
import Resonance from "@/components/Resonance";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

const LENGTH_VALUES = ["short", "standard", "long"] as const;

const formSchema = z.object({
  title: z.string().optional(),
  vibe: z.nativeEnum(Vibe),
  lyrics: z.string().optional(),
  length: z.enum(LENGTH_VALUES),
});

export default function Home() {
  const [, setLocation] = useLocation();
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const createProject = useCreateProject();
  const uploadHum = useUploadHum();
  const startGeneration = useStartGeneration();
  const { data: projects, isLoading: isLoadingProjects } = useListProjects();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      vibe: "pop",
      lyrics: "",
      length: "standard",
    },
  });

  const selectedVibe = form.watch("vibe");
  const lyricsValue = form.watch("lyrics");
  const hasLyrics = !!lyricsValue?.trim();

  const isSubmitting = createProject.isPending || uploadHum.isPending || startGeneration.isPending;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!recordedBlob) {
      alert("Please record a melody first!");
      return;
    }

    try {
      const project = await createProject.mutateAsync({
        data: {
          title: values.title || "My Hummed Melody",
          vibe: values.vibe,
          lyrics: values.lyrics?.trim() || undefined,
          length: values.length,
        }
      });

      await uploadHum.mutateAsync({
        projectId: project.id,
        data: { file: recordedBlob }
      });

      await startGeneration.mutateAsync({ projectId: project.id });

      setLocation(`/projects/${project.id}`);
    } catch (error) {
      console.error("Failed to process melody:", error);
      alert("Something went wrong while creating your song. Please try again.");
    }
  };

  const vibes: { value: Vibe; label: string; icon: React.ReactNode; color: string }[] = [
    { value: "pop", label: "Pop", icon: <Sparkles className="w-5 h-5" />, color: "bg-pink-500" },
    { value: "lofi", label: "Lo-Fi", icon: <Headphones className="w-5 h-5" />, color: "bg-amber-500" },
    { value: "cinematic", label: "Cinematic", icon: <Wand2 className="w-5 h-5" />, color: "bg-indigo-500" },
    { value: "rnb", label: "R&B", icon: <Music className="w-5 h-5" />, color: "bg-purple-500" },
    { value: "electronic", label: "Electronic", icon: <Sparkles className="w-5 h-5" />, color: "bg-cyan-500" },
    { value: "acoustic", label: "Acoustic", icon: <Music className="w-5 h-5" />, color: "bg-emerald-500" },
    { value: "ambient", label: "Ambient", icon: <Wand2 className="w-5 h-5" />, color: "bg-teal-500" },
    { value: "serenity", label: "Serenity", icon: <Flower2 className="w-5 h-5" />, color: "bg-rose-500" },
    { value: "soul", label: "Soul", icon: <Heart className="w-5 h-5" />, color: "bg-orange-500" },
    { value: "jazz", label: "Jazz", icon: <Piano className="w-5 h-5" />, color: "bg-blue-500" },
    { value: "folk", label: "Folk", icon: <Guitar className="w-5 h-5" />, color: "bg-lime-500" },
    { value: "afrobeat", label: "Afrobeat", icon: <Drum className="w-5 h-5" />, color: "bg-red-500" },
    { value: "synthwave", label: "Synthwave", icon: <Radio className="w-5 h-5" />, color: "bg-fuchsia-500" },
  ];

  const lengths: { value: (typeof LENGTH_VALUES)[number]; label: string; hint: string }[] = [
    { value: "short", label: "Short", hint: "~30 sec" },
    { value: "standard", label: "Standard", hint: "~90 sec" },
    { value: "long", label: "Long", hint: "up to 3 min" },
  ];

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="text-center mb-16 space-y-4">
        <div className="mx-auto mb-2 h-56 w-56 md:h-64 md:w-64">
          <Resonance vibe={selectedVibe} className="h-full w-full" />
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground">
          Hum a melody.<br/>
          <span className="text-gradient">Get a real song.</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-medium">
          Welcome to your magical browser studio. Hum the tune stuck in your head, pick a vibe, and watch it transform into a fully produced track.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-12 items-start mb-24">
        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm">1</span>
              Record your idea
            </h2>
            <AudioRecorder 
              onRecordingComplete={(blob) => setRecordedBlob(blob)} 
              disabled={isSubmitting}
            />
            {recordedBlob && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-secondary/10 text-secondary border border-secondary/20 animate-in fade-in slide-in-from-bottom-2">
                <Music className="w-5 h-5" />
                <span className="font-medium">Melody captured! ({Math.round(recordedBlob.size / 1024)} KB)</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm">2</span>
              Shape the song
            </h2>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 p-8 rounded-3xl glass-panel relative">
                {isSubmitting && (
                  <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                    <p className="text-lg font-bold animate-pulse">Summoning the band...</p>
                  </div>
                )}
                
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold">Give it a name (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Summer Breeze Hook" className="text-lg py-6 rounded-2xl bg-background/50 border-white/20" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="lyrics"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold">Write your lyrics (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={"Type the words you want sung...\n\nLeave blank for an instrumental track."}
                          className="min-h-32 text-base py-4 rounded-2xl bg-background/50 border-white/20 resize-y"
                          data-testid="input-lyrics"
                          {...field}
                        />
                      </FormControl>
                      <div
                        className={`flex items-center gap-2 text-sm font-medium rounded-xl px-3 py-2 ${
                          hasLyrics
                            ? "bg-primary/10 text-primary"
                            : "bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        {hasLyrics ? <Mic2 className="w-4 h-4 shrink-0" /> : <Music className="w-4 h-4 shrink-0" />}
                        <span>
                          {hasLyrics
                            ? "These words will be sung in the key & tempo of your hum."
                            : "No lyrics yet — you'll get an instrumental track."}
                        </span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="length"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4" /> Song length
                      </FormLabel>
                      <FormControl>
                        <div className="grid grid-cols-3 gap-3">
                          {lengths.map((l) => (
                            <button
                              type="button"
                              key={l.value}
                              onClick={() => field.onChange(l.value)}
                              data-testid={`length-${l.value}`}
                              className={`rounded-2xl border-2 p-4 text-center transition-all duration-200 ${
                                field.value === l.value
                                  ? "border-primary bg-primary/10 shadow-md shadow-primary/20 scale-[1.02]"
                                  : "border-transparent bg-muted/50 hover:bg-muted"
                              }`}
                            >
                              <div className="font-bold">{l.label}</div>
                              <div className="text-xs text-muted-foreground mt-1">{l.hint}</div>
                            </button>
                          ))}
                        </div>
                      </FormControl>
                      <p className="text-sm text-muted-foreground">Longer songs take a little more time and credits to produce.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vibe"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold mb-4 block">Pick a vibe</FormLabel>
                      <FormControl>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {vibes.map((v) => (
                            <div
                              key={v.value}
                              className={`relative cursor-pointer rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
                                field.value === v.value
                                  ? "border-primary bg-primary/10 shadow-md shadow-primary/20 scale-[1.02]"
                                  : "border-transparent bg-muted/50 hover:bg-muted"
                              }`}
                              onClick={() => field.onChange(v.value)}
                              data-testid={`vibe-${v.value}`}
                            >
                              <div className="p-4 flex flex-col items-center gap-2 text-center">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-inner ${v.color}`}>
                                  {v.icon}
                                </div>
                                <span className="font-semibold text-sm">{v.label}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full text-lg py-8 rounded-2xl shadow-xl shadow-primary/30 hover:scale-[1.02] transition-transform font-bold group"
                  disabled={!recordedBlob || isSubmitting}
                  data-testid="button-create-song"
                >
                  <Sparkles className="w-5 h-5 mr-2 group-hover:animate-spin" />
                  Produce My Song
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Recent Studio Magic</h2>
          <Link href="/projects" className="text-primary hover:underline font-medium">View all</Link>
        </div>
        
        {isLoadingProjects ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : !projects?.length ? (
          <div className="text-center p-12 rounded-3xl border-2 border-dashed border-muted-foreground/20 text-muted-foreground">
            <Music className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No songs created yet. Be the first to lay down a track!</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {projects.slice(0, 3).map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="hover-elevate cursor-pointer transition-all border-none bg-card/60 backdrop-blur-md hover:bg-card overflow-hidden group">
                  <div className="h-32 bg-gradient-to-br from-primary/20 via-secondary/20 to-accent/20 relative flex items-center justify-center">
                    <Music className="w-12 h-12 text-primary/40 group-hover:scale-110 transition-transform group-hover:text-primary/60" />
                    <div className="absolute bottom-3 left-3 bg-background/80 backdrop-blur text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider text-primary">
                      {project.vibe}
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <h3 className="font-bold text-xl mb-2 line-clamp-1">{project.title}</h3>
                    <div className="flex items-center justify-between text-sm text-muted-foreground font-medium">
                      <span>{project.stage === "complete" ? "Finished Track" : "In Progress..."}</span>
                      <span>{formatDistanceToNow(new Date(project.createdAt))} ago</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
