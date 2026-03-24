-- Ensure dwhitby@gmail.com is admin and approved (migration 013 may have run before account existed)
UPDATE users SET is_admin = true, is_approved = true, updated_at = NOW() WHERE email = 'dwhitby@gmail.com';
