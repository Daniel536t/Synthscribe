import express, { Request, Response } from "express";

const app = express();

app.use(express.json());

// REMOVE pino-http for Vercel stability

app.get("/", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Synthscribe API running on Vercel"
  });
});

export default app;
