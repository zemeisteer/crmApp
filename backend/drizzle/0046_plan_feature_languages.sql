ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features_ru" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- The three original tiers, where their Uzbek list is still the shipped one
-- and no translation was written yet: give them the shipped translations.
-- Lists the platform admin has edited are left alone (the site then shows
-- the Uzbek list until a translation is entered).
UPDATE "plans" SET "features_ru" = E'1 филиал\nДо 50 учеников\nОсновные функции', "features_en" = E'1 branch\nUp to 50 students\nCore features'
  WHERE "key" = 'STARTER' AND "features" = E'1 filial\n50 tagacha o''quvchi\nAsosiy CRUD' AND "features_ru" = '' AND "features_en" = '';--> statement-breakpoint
UPDATE "plans" SET "features_ru" = E'Без ограничения филиалов\nДо 500 учеников\nПосещаемость, отчёты\nУведомления в Telegram', "features_en" = E'Unlimited branches\nUp to 500 students\nAttendance, reports\nTelegram notifications'
  WHERE "key" = 'STANDARD' AND "features" = E'Cheksiz filial\n500 tagacha o''quvchi\nDavomat, hisobotlar\nTelegram xabarnomalar' AND "features_ru" = '' AND "features_en" = '';--> statement-breakpoint
UPDATE "plans" SET "features_ru" = E'Без ограничения учеников\nИИ-аналитика и материалы\nИнтеграция Click/Payme\nПриоритетная поддержка', "features_en" = E'Unlimited students\nAI analysis and materials\nClick/Payme integration\nPriority support'
  WHERE "key" = 'PREMIUM' AND "features" = E'Cheksiz o''quvchi\nAI tahlil va materiallar\nClick/Payme integratsiya\nUstuvor qo''llab-quvvatlash' AND "features_ru" = '' AND "features_en" = '';
