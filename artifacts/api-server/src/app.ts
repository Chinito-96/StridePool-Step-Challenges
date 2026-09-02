import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";
import { processStripeWebhook } from "./services/stripe-provider";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const signature = req.header("stripe-signature");
    if (!signature) {
      res.status(400).json({ error: "Missing Stripe signature." });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(500).json({ error: "Stripe webhook body was not preserved." });
      return;
    }
    try {
      const result = await processStripeWebhook(req.body, signature);
      res.status(200).json(result);
    } catch (error) {
      req.log.warn({ err: error }, "Stripe webhook rejected");
      res.status(400).json({ error: "Stripe webhook verification failed." });
    }
  },
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
