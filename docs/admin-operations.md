# StridePool admin operations

The internal admin console is available at `/admin`. It is not linked from the public navigation and every admin API request requires both an authenticated session and a database user whose `role` is `admin`.

New users default to `role = 'user'`. Promote an existing authenticated user from the database console with:

```sql
UPDATE users
SET role = 'admin', updated_at = now()
WHERE email = 'operator@example.com';
```

The console is read-only. It uses:

- `daily_step_records` and pending `step_source_samples` for anti-cheat review.
- `challenges` for status and pool totals.
- `wallet_ledger_entries` plus settled challenge data for payout and refund history.
- `users` and `entries` for support lookup.