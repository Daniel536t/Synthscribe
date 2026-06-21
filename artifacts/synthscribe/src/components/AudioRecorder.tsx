import { useState, useRef, useEffect } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { audioReactive } from "@/lib/audioReactive";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export default function AudioRecorder({ onRecordingComplete, disabled }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioReactive.stop();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Feed the shared analyser so the 3D "Resonance" orb reacts to the hum.
      await audioReactive.connectStream(stream);

      const updateVolume = () => {
        if (!recordingRef.current) return;
        setVolume(audioReactive.getLevel());
        rafRef.current = requestAnimationFrame(updateVolume);
      };

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        onRecordingComplete(blob);
        stream.getTracks().forEach((track) => track.stop());
        audioReactive.stop();
        setVolume(0);
      };

      mediaRecorder.start();
      recordingRef.current = true;
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      updateVolume();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please ensure permissions are granted.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      recordingRef.current = false;
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col items-center gap-6 p-8 rounded-3xl glass-panel relative overflow-hidden">
      {isRecording && (
        <div
          className="absolute inset-0 bg-primary/5 transition-transform duration-75"
          style={{ transform: `scale(${1 + volume * 0.8})` }}
        />
      )}

      <div className="relative z-10 flex flex-col items-center gap-4">
        <Button
          size="icon"
          variant={isRecording ? "destructive" : "default"}
          className={`w-24 h-24 rounded-full shadow-xl transition-all duration-300 ${
            isRecording ? "animate-pulse shadow-destructive/50" : "hover:scale-105 shadow-primary/50"
          }`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled && !isRecording}
          data-testid="button-record"
        >
          {isRecording ? (
            <Square className="w-8 h-8 fill-current" />
          ) : (
            <Mic className="w-10 h-10" />
          )}
        </Button>

        <div className="flex flex-col items-center">
          <span className={`text-3xl font-mono tracking-wider transition-colors ${isRecording ? "text-destructive font-bold" : "text-muted-foreground"}`}>
            {formatTime(recordingTime)}
          </span>
          <span className="text-sm font-medium text-muted-foreground mt-1 uppercase tracking-widest">
            {isRecording ? "Recording..." : "Tap to record hum"}
          </span>
        </div>
      </div>
    </div>
  );
}
