import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCheckoutBody,
  CreateWithdrawalBody,
  StartPayoutOnboardingBody,
} from "@workspace/api-zod";
import {
  createCheckout,
  getPayoutAccount,
  createProSubscriptionCheckout,
  createMembershipBillingPortal,
  getLedger,
  isProviderConfigured,
  startPayoutOnboarding,
  withdrawAvailableBalance,
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

router.post("/billing/portal", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!isProviderConfigured()) {
    res.status(409).json({ error: "Membership management is unavailable until Stripe and its signed webhook are configured." });
    return;
  }
  try {
    res.status(201).json(await createMembershipBillingPortal(userId));
  } catch (error) {
    req.log.warn({ err: error }, "Billing portal creation failed");
    res.status(409).json({ error: "Membership management is unavailable. Please try again later." });
  }
});

router.post("/billing/pro-checkout", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!isProviderConfigured()) {
    res.status(409).json({ error: "Pro checkout is unavailable until Stripe and its signed webhook are configured." });
    return;
  }
  try {
    res.status(201).json(await createProSubscriptionCheckout(userId));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Pro checkout is unavailable." });
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
  try {
    res.status(201).json(await startPayoutOnboarding(userId, parsed.data));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Payout onboarding is unavailable." });
  }
});

router.get("/money/payout-account", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    res.json(await getPayoutAccount(userId));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Payout account status is unavailable." });
  }
});

router.post("/money/withdrawal", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Withdrawal details are invalid." });
    return;
  }
  if (!isProviderConfigured()) {
    res.status(409).json({ error: "Withdrawals are unavailable until Stripe is configured." });
    return;
  }
  try {
    res.status(201).json(await withdrawAvailableBalance(userId, parsed.data));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Withdrawal is unavailable." });
  }
});

router.get("/money/ledger", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(await getLedger(userId));
});

export default router;