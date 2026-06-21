import express, { Request, Response } from "express";
import * as pinoHttp from "pino-http";

const app = express();

// SAFE fallback for Vercel + TS builds
const logger = (pinoHttp as any).default?.() ?? (pinoHttp as any)();

app.use(express.json());
app.use(logger);

app.get("/", (req: Request, res: Response) => {
  res.send("Synthscribe API running");
});

export default app;
