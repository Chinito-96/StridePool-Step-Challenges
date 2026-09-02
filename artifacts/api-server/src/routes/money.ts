import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCheckoutBody,
  ReceiveProviderWebhookBody,
  StartPayoutOnboardingBody,
} from "@workspace/api-zod";
import {
  createCheckout,
  getLedger,
  isProviderConfigured,
  recordProviderWebhook,
  startPayoutOnboarding,
  verifyProviderWebhookSignature,
} from "../services/ledger";

const router: IRouter = Router();

function requireUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required." });
    return null;
  }
  return req.user.id;
}

router.post("/money/checkout", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = CreateCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Checkout details are invalid." });
    return;
  }
  if (!isProviderConfigured()) {
    res.status(409).json({ error: "Paid checkout is unavailable until a payment provider and signed webhook secret are configured." });
    return;
  }
  try {
    res.status(201).json(await createCheckout(userId, parsed.data));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Checkout is not available." });
  }
});

router.post("/money/payout-onboarding", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = StartPayoutOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Payout onboarding details are invalid." });
    return;
  }
  if (!isProviderConfigured()) {
    res.status(409).json({ error: "Payout onboarding is unavailable until a payment provider and signed webhook secret are configured." });
    return;
  }
  res.status(201).json(await startPayoutOnboarding(userId, parsed.data));
});

router.get("/money/ledger", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(await getLedger(userId));
});

router.post("/money/provider-webhook", async (req, res): Promise<void> => {
  if (!isProviderConfigured()) {
    res.status(401).json({ error: "Provider webhook verification is not configured." });
    return;
  }
  const signature = req.header("x-provider-signature") ?? "";
  if (!verifyProviderWebhookSignature(JSON.stringify(req.body), signature)) {
    res.status(401).json({ error: "Provider webhook signature is invalid." });
    return;
  }
  const parsed = ReceiveProviderWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provider event is invalid." });
    return;
  }
  res.status(202).json(await recordProviderWebhook(parsed.data));
});

export default router;