-- Grandfather kittrellcourt@gmail.com as Pro (full access, no payment required)
UPDATE users
SET subscription_plan = 'pro',
    subscription_status = 'grandfathered',
    updated_at = NOW()
WHERE email = 'kittrellcourt@gmail.com';
