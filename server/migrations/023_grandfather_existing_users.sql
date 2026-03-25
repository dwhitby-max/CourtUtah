-- Grandfather existing users as Pro with no Stripe subscription required
UPDATE users
SET subscription_plan = 'pro',
    subscription_status = 'grandfathered',
    updated_at = NOW()
WHERE id IN (1);
