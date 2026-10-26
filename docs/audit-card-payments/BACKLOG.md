# Backlog: three useful capabilities seen in similar platforms

A short comparison with three CRMs for education centers, from their own
sites (checked 2026-10-26). Not built here: each is a decision for later,
and having it elsewhere is not by itself a reason to build it.

## 1. Lesson packages ("абонементы") with lessons deducted on attendance

- **Seen in:** HOLLIHOP ("Абонементы, цены, должники", payment of a package in
  the app), Мой Класс ("учёт оплат, абонементов, задолженностей").
- **Why it matters here:** TalimCRM bills by month per group. Centers that sell
  8 or 12 lessons, individual tutoring, or trial packs today keep that by hand.
  A package with a balance, decreased by attendance (the per-lesson marks
  already exist), would remove that and make "how many lessons are left"
  visible to parents.
- **Size:** medium. A package table, deduction from attendance, a balance in
  the cabinet. Months stay the default.

## 2. Receipts for online payments (fiscalisation)

- **Seen in:** HOLLIHOP ("Автовыставление счетов, онлайн-оплата и чеки").
- **Why it matters here:** once a center or the platform takes Click/Payme
  payments as a business, the payment providers' fiscal receipt requirements
  in Uzbekistan apply. Payme's merchant API asks for the receipt items in
  CheckPerformTransaction.
- **Not verified:** the exact current requirements were not checked against
  Click's and Payme's documentation in this pass. That is the first step.
- **Size:** small to medium. The service code, the package code and the VAT of
  the tariff or group price, sent with the transaction.

## 3. A parent/student app with push, or an installable web cabinet (PWA)

- **Seen in:** HOLLIHOP (Schoolmaster app for students and parents), Мой Класс
  ("Личный кабинет и мобильное приложение… ученикам и родителям"; push about
  debts), AlfaCRM ("ALFACRM Кабинет клиента" app with online payment and the
  remaining lessons).
- **Why it matters here:** TalimCRM reaches parents through the web cabinet
  and the Telegram bot, which covers most of this in Uzbekistan. An
  installable cabinet (PWA) with web push is the cheap step before any native
  app: a debt or homework notice without Telegram.
- **Size:** small (PWA and push) to large (native apps). Only the small step
  is suggested.

## Sources

- HOLLIHOP: https://holyhope.ru/
- Мой Класс: https://moyklass.com/
- AlfaCRM: https://alfacrm.pro/ and https://apps.apple.com/ru/app/id6478144118
