-- Add per-field edit tracking columns to attendance table
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_edited BOOLEAN DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_edited BOOLEAN DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_edited_by TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_edited_by TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_edited_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_edited_at TIMESTAMPTZ;
