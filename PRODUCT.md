# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One household user managing multiple local accounts on a Windows-first desktop application.

## Product Purpose

The budget planner keeps household transaction data on the device and helps the user understand monthly spending, targets, and forecasts from imported or manually entered transactions.

## Positioning

The planner is local-first: transaction content stays on-device by default, with deterministic import, merchant normalization, categorization, backup, restore, and export workflows instead of cloud banking or opaque automation.

## Operating Context

The user opens the desktop application to review a selected month, inspect spending by category, compare actuals with targets, review a forecast, import digital bank statements, and maintain local backup snapshots.

## Capabilities and Constraints

- The application uses Electron, React, TypeScript, and SQLite.
- Supported inputs include digital PDF statements, CSV imports, and manual transaction entry.
- The primary dashboard job is helping the user understand the selected month quickly.
- Financial data remains local by default; the product does not add bank APIs, cloud sync, telemetry, analytics, or background network calls.
- Domain terminology is household, account, transaction, category, merchant alias, categorization rule, import job, budget target, forecast assumption, and backup snapshot.

## Evidence on Hand

The existing renderer surface is `src/renderer/App.tsx` and composes monthly totals, category breakdown, target-versus-actual, category target entry, forecast, CSV/PDF import, backup, and restore sections. No approved visual brand assets or design system were provided.

## Product Principles

- Keep financial data local and explainable.
- Make the selected month's financial picture understandable at a glance.
- Surface uncertainty and correction workflows instead of hiding them.
- Preserve recovery and portability through backup and export.
