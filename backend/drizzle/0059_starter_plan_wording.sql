-- The Starter tier's last line read "Asosiy CRUD" (developer jargon) on the
-- public price list. Where it is still the shipped text, say it plainly;
-- a list the platform admin has edited is left alone.
UPDATE "plans" SET "features" = E'1 filial\n50 tagacha o''quvchi\nAsosiy imkoniyatlar'
  WHERE "key" = 'STARTER' AND "features" = E'1 filial\n50 tagacha o''quvchi\nAsosiy CRUD';
