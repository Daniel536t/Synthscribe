import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, Waveform } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!isRecording) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setVolume(avg);
        requestAnimationFrame(updateVolume);
      };

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        onRecordingComplete(blob);
        stream.getTracks().forEach((track) => track.stop());
        setVolume(0);
      };

      mediaRecorder.start();
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
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
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
          className="absolute inset-0 bg-primary/5 transition-all duration-75"
          style={{ transform: `scale(${1 + volume / 500})` }}
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
