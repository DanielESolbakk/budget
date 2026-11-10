import { DatabaseSync } from "node:sqlite";
import {
  validateReportingPeriodRule,
  type ReportingPeriodRule,
  DEFAULT_REPORTING_PERIOD_RULE,
} from "../../shared/applicationPreferences.js";

export function createReportingPreferencesRepository(db: DatabaseSync) {
  function getReportingPeriodRule(householdId: string): ReportingPeriodRule {
    const row = db.prepare(
      "SELECT reporting_period_rule_json FROM household_preferences WHERE household_id = ?"
    ).get(householdId) as { reporting_period_rule_json: string } | undefined;

    if (row === undefined) return { ...DEFAULT_REPORTING_PERIOD_RULE };

    let storedValue: unknown;
    try {
      storedValue = JSON.parse(row.reporting_period_rule_json);
    } catch (error) {
      throw new Error(`Stored reporting period preference is invalid for household ${householdId}.`, {
        cause: error,
      });
    }

    return validateReportingPeriodRule(storedValue);
  }

  function saveReportingPeriodRule(
    householdId: string,
    rule: ReportingPeriodRule
  ): ReportingPeriodRule {
    const validatedRule = validateReportingPeriodRule(rule);
    const household = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
    if (household === undefined) {
      throw new Error(`Household not found: ${householdId}`);
    }

    db.prepare(`
      INSERT INTO household_preferences (household_id, reporting_period_rule_json)
      VALUES (?, ?)
      ON CONFLICT(household_id) DO UPDATE SET
        reporting_period_rule_json = excluded.reporting_period_rule_json
    `).run(householdId, JSON.stringify(validatedRule));

    return validatedRule;
  }

  return { getReportingPeriodRule, saveReportingPeriodRule };
}
