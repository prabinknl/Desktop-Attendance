-- Add manual_check_in and manual_check_out columns to attendance table
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS manual_check_in TIME;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS manual_check_out TIME;
