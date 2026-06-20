"""
SynthScribe MusicGen melody worker (Modal, A10G GPU).

Exposes a small FastAPI app:
  - GET  /health    -> {"status": "ok"}  (also reports the model name)
  - POST /generate  -> melody-conditioned backing track as a 44.1kHz stereo WAV

The backend (artifacts/api-server) POSTs multipart form data:
  file:     the user's hum, a WAV buffer (already normalized to 44.1kHz)
  vibe:     one of the SynthScribe vibe keys (lofi, cinematic, pop, ...)
  duration: target length in seconds

Model: facebook/musicgen-melody via HuggingFace transformers
(MusicgenMelodyForConditionalGeneration). It conditions generation on the
chroma (melody contour) of the supplied hum so the produced instrumental
follows the hummed tune. Using transformers (rather than audiocraft) keeps the
dependency set to prebuilt wheels (torch, torchaudio, transformers) and avoids
compiling PyAV from source.

Weights are cached in a Modal Volume to avoid re-downloading on every cold
start, and one container is kept warm.

Deploy:  modal deploy musicgen_worker.py   (run from outside the git repo)
"""

import io
import os
import secrets

import modal

app = modal.App("synthscribe-musicgen")

# ---------------------------------------------------------------------------
# Container image: CUDA-enabled torch + HuggingFace transformers. All deps
# ship as prebuilt wheels, so there is no source compilation step.
# ---------------------------------------------------------------------------
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.4.1",
        "torchaudio==2.4.1",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "transformers==4.46.3",
        "accelerate==1.1.1",
        "sentencepiece==0.2.0",
        "soundfile==0.12.1",
        "scipy==1.14.1",
        "numpy<2",
        "fastapi[standard]==0.115.6",
        "python-multipart==0.0.20",
    )
    .env(
        {
            "HF_HOME": "/cache/hf",
            "TORCH_HOME": "/cache/torch",
        }
    )
)

# Persistent cache for downloaded model weights (~3.5GB for musicgen-melody).
cache_vol = modal.Volume.from_name("synthscribe-model-cache", create_if_missing=True)

MODEL_NAME = "facebook/musicgen-melody"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # reject oversized hum uploads
TARGET_SR = 44100
# MusicGen emits audio tokens at ~50 Hz; tokens ≈ duration_seconds * 50.
TOKENS_PER_SECOND = 50

# Map each SynthScribe vibe to a descriptive MusicGen text prompt so the
# generated backing matches the selected mood while following the hum.
VIBE_PROMPTS = {
    "lofi": "warm lo-fi hip-hop instrumental, dusty vinyl crackle, mellow Rhodes piano, soft boom-bap drums, relaxed groove",
    "cinematic": "epic cinematic instrumental score, lush strings, swelling brass, wide film-trailer atmosphere, emotional",
    "pop": "bright modern pop instrumental, catchy synths, punchy drums, radio-ready polish, upbeat",
    "rnb": "smooth contemporary R&B instrumental, silky electric piano, deep bass, laid-back groove",
    "electronic": "polished electronic dance instrumental, analog synths, driving four-on-the-floor beat, club energy",
    "acoustic": "intimate acoustic instrumental, fingerpicked guitar, soft percussion, organic warmth",
    "ambient": "spacious ambient instrumental, evolving pads, gentle textures, weightless and dreamy",
}


@app.cls(
    gpu="A10G",
    image=image,
    volumes={"/cache": cache_vol},
    secrets=[modal.Secret.from_name("synthscribe-backing-auth")],
    min_containers=1,  # keep one warm to avoid cold starts
    scaledown_window=300,
    timeout=240,  # aligned with the backend's request timeout
)
class Backing:
    @modal.enter()
    def load(self):
        import torch
        from transformers import (
            AutoProcessor,
            MusicgenMelodyForConditionalGeneration,
        )

        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(MODEL_NAME)
        self.model = MusicgenMelodyForConditionalGeneration.from_pretrained(
            MODEL_NAME
        ).to("cuda")
        self.model.eval()
        self.out_sr = self.model.config.audio_encoder.sampling_rate
        cache_vol.commit()

    def _generate(self, hum_bytes: bytes, vibe: str, duration: int) -> bytes:
        import numpy as np
        import soundfile as sf
        import torch
        import torchaudio

        duration = max(8, min(int(duration or 18), 30))
        prompt = VIBE_PROMPTS.get(vibe, VIBE_PROMPTS["pop"])

        # Load the hum melody as mono for chroma conditioning.
        melody, sr = torchaudio.load(io.BytesIO(hum_bytes))  # [channels, samples]
        # The musicgen-melody feature extractor resamples the conditioning audio
        # with torchaudio (which reads waveform.device), so it must be a torch
        # tensor, not a numpy array.
        melody_mono = melody.mean(dim=0).to(torch.float32)  # 1D tensor [samples]

        inputs = self.processor(
            audio=melody_mono,
            sampling_rate=sr,
            text=[prompt],
            padding=True,
            return_tensors="pt",
        )
        inputs = inputs.to("cuda")

        max_new_tokens = int(duration * TOKENS_PER_SECOND)
        with torch.no_grad():
            audio_values = self.model.generate(
                **inputs,
                do_sample=True,
                guidance_scale=3.0,
                max_new_tokens=max_new_tokens,
            )

        audio = audio_values[0, 0].cpu().float()  # mono [samples] at out_sr
        audio = audio.unsqueeze(0)  # [1, samples]
        audio = torchaudio.functional.resample(audio, self.out_sr, TARGET_SR)
        audio = audio.repeat(2, 1)  # mono -> stereo

        # Normalize to avoid clipping before the backend's own mastering.
        peak = audio.abs().max().item()
        if peak > 0:
            audio = audio / peak * 0.97

        buf = io.BytesIO()
        sf.write(buf, audio.t().numpy(), TARGET_SR, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, File, Form, Request, UploadFile
        from fastapi.responses import JSONResponse, Response

        webapp = FastAPI(title="SynthScribe MusicGen")

        @webapp.get("/health")
        def health():
            return {"status": "ok", "model": MODEL_NAME}

        @webapp.post("/generate")
        async def generate(
            request: Request,
            file: UploadFile = File(...),
            vibe: str = Form("pop"),
            duration: int = Form(18),
        ):
            try:
                # Require a shared bearer token so the GPU endpoint cannot be
                # invoked by anyone who discovers the public URL.
                expected = os.environ.get("MODAL_BACKING_TOKEN")
                if expected:
                    header = request.headers.get("authorization", "")
                    token = (
                        header[7:]
                        if header.lower().startswith("bearer ")
                        else ""
                    )
                    if not secrets.compare_digest(token, expected):
                        return JSONResponse(
                            status_code=401, content={"error": "unauthorized"}
                        )

                data = await file.read()
                if not data:
                    return JSONResponse(
                        status_code=400, content={"error": "empty hum upload"}
                    )
                if len(data) > MAX_UPLOAD_BYTES:
                    return JSONResponse(
                        status_code=413, content={"error": "hum upload too large"}
                    )
                wav = self._generate(data, vibe, duration)
                return Response(content=wav, media_type="audio/wav")
            except Exception as exc:  # noqa: BLE001
                import traceback

                traceback.print_exc()
                return JSONResponse(
                    status_code=500,
                    content={"error": str(exc)[:500], "type": type(exc).__name__},
                )

        return webapp
