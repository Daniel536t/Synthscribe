import { useListProjects } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Music, Calendar, Clock, Activity, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";

export default function Library() {
  const { data: projects, isLoading } = useListProjects();

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Your Studio Library</h1>
        <p className="text-xl text-muted-foreground font-medium">All the melodies you've transformed into magic.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      ) : !projects?.length ? (
        <div className="text-center py-24 rounded-3xl border-2 border-dashed border-muted text-muted-foreground">
          <Music className="w-16 h-16 mx-auto mb-6 opacity-20" />
          <h2 className="text-2xl font-bold text-foreground mb-2">No tracks yet</h2>
          <p className="mb-6 text-lg">Hit the studio and record your first hum!</p>
          <Link href="/">
            <a className="inline-flex items-center justify-center h-12 px-8 rounded-full bg-primary text-primary-foreground font-bold hover:scale-105 transition-transform">
              Go to Studio
            </a>
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover-elevate cursor-pointer transition-all border-none bg-card/60 backdrop-blur-md hover:bg-card overflow-hidden group h-full flex flex-col">
                <div className="h-40 bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/10 relative flex items-center justify-center">
                  <Music className="w-16 h-16 text-primary/30 group-hover:scale-110 transition-transform group-hover:text-primary/50" />
                  <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
                    <div className="bg-background/80 backdrop-blur text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider text-primary">
                      {project.vibe}
                    </div>
                    {project.renderMode === "note_for_note" && (
                      <div className="bg-primary/90 backdrop-blur text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider" data-testid={`badge-note-for-note-${project.id}`}>
                        Note-for-Note
                      </div>
                    )}
                  </div>
                  {project.stage !== "complete" && project.stage !== "error" && (
                    <div className="absolute top-4 left-4 bg-secondary/80 backdrop-blur text-secondary-foreground text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      In Progress
                    </div>
                  )}
                  {project.stage === "error" && (
                    <div className="absolute top-4 left-4 bg-destructive/80 backdrop-blur text-destructive-foreground text-xs font-bold px-3 py-1.5 rounded-full">
                      Error
                    </div>
                  )}
                </div>
                <CardContent className="p-6 flex-1 flex flex-col">
                  <h3 className="font-bold text-2xl mb-2 line-clamp-2 leading-tight">{project.title}</h3>
                  {project.theme && (
                    <p className="text-sm font-semibold text-primary line-clamp-1 mb-2" data-testid={`text-theme-${project.id}`}>
                      &ldquo;{project.theme}&rdquo;
                    </p>
                  )}
                  {project.lyrics && (
                    <p className="text-sm text-muted-foreground italic line-clamp-2 mb-4 flex-1">
                      {project.lyrics}
                    </p>
                  )}
                  
                  <div className="space-y-3 pt-4 border-t border-border/50 mt-auto">
                    <div className="flex items-center text-sm text-muted-foreground font-medium">
                      <Calendar className="w-4 h-4 mr-3 opacity-70" />
                      {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
                    </div>
                    {project.durationSeconds && (
                      <div className="flex items-center text-sm text-muted-foreground font-medium">
                        <Clock className="w-4 h-4 mr-3 opacity-70" />
                        {Math.floor(project.durationSeconds / 60)}:{(project.durationSeconds % 60).toString().padStart(2, '0')}
                      </div>
                    )}
                    {project.key && project.tempo && (
                      <div className="flex items-center text-sm text-muted-foreground font-medium">
                        <Activity className="w-4 h-4 mr-3 opacity-70" />
                        {project.key} • {project.tempo} BPM
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
