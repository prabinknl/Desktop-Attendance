-- Clear legacy 'rule=FIRST_LAST_PUNCH' remarks from attendance records
UPDATE attendance SET remarks = NULL WHERE remarks = 'rule=FIRST_LAST_PUNCH' OR remarks LIKE 'rule=%';
