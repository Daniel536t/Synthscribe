import express, { Request, Response } from "express";
import * as pinoHttp from "pino-http";

const app = express();

// FIX: pino-http is a factory function in this form
const logger = pinoHttp();

app.use(express.json());
app.use(logger);

app.get("/", (req: Request, res: Response) => {
  res.send("Synthscribe API is running");
});

export default app;
