import { Router, type IRouter } from "express";
import {
  CreateCheckoutBody,
  GetLedgerQueryParams,
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

router.post("/money/checkout", (req, res) => {
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
    res.status(201).json(createCheckout(parsed.data));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Checkout is not available." });
  }
});

router.post("/money/payout-onboarding", (req, res) => {
  const parsed = StartPayoutOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Payout onboarding details are invalid." });
    return;
  }
  if (!isProviderConfigured()) {
    res.status(409).json({ error: "Payout onboarding is unavailable until a payment provider and signed webhook secret are configured." });
    return;
  }
  res.status(201).json(startPayoutOnboarding(parsed.data));
});

router.get("/money/ledger", (req, res) => {
  const parsed = GetLedgerQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A user id is required." });
    return;
  }
  res.json(getLedger(parsed.data.userId));
});

router.post("/money/provider-webhook", (req, res) => {
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
  res.status(202).json(recordProviderWebhook(parsed.data));
});

export default router;