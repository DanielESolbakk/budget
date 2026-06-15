/**
 * Shared planning issue validation checks.
 * Centralizes heading, reference, and basic structure validation.
 */

module.exports.escapeRegex = function(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

module.exports.getSectionValue = function(markdown, heading) {
  const escapedHeading = module.exports.escapeRegex(heading);
  const regex = new RegExp(
    `###\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`,
    "i"
  );
  const match = markdown.match(regex);
  if (!match) {
    return "";
  }
  return match[1].replace(/_No response_/gi, "").trim();
};

module.exports.normalizeValue = function(value) {
  return String(value || "")
    .replace(/_No response_/gi, "")
    .trim();
};

module.exports.hasMeaningfulText = function(value) {
  const normalized = module.exports.normalizeValue(value);
  return Boolean(normalized) && !/^(none|n\/a|not applicable)$/i.test(normalized);
};

module.exports.parseIssueReferences = function(value) {
  const matches = [...String(value || "").matchAll(/(?:#|\/issues\/)(\d+)/gi)];
  return [...new Set(matches.map((match) => Number(match[1])))]
    .filter((number) => Number.isInteger(number) && number > 0);
};

module.exports.checkBasicStructure = function(body, issueType) {
  const missing = [];

  function hasHeading(h) {
    return body.includes(h);
  }

  function hasIssueRefAfterHeading(heading) {
    const idx = body.indexOf(heading);
    if (idx === -1) return false;
    const after = body
      .slice(idx + heading.length)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (after.length === 0) return false;
    if (/^#\d+/.test(after[0])) return true;
    if (issueType === "epic" && /^_?None_?$/i.test(after[0])) return true;
    return /#\d+/.test(after.join("\n"));
  }

  if (issueType !== "epic") {
    if (!hasHeading("### Parent Epic Issue"))
      missing.push("Parent Epic Issue heading");
    if (!hasHeading("### Parent Feature Issue"))
      missing.push("Parent Feature Issue heading");
    if (
      !hasIssueRefAfterHeading("### Parent Epic Issue") &&
      !/Parent Epic Issue:?\s*#\d+/.test(body)
    )
      missing.push("Parent Epic Issue must include a reference like #123");
    if (
      !hasIssueRefAfterHeading("### Parent Feature Issue") &&
      !/Parent Feature Issue:?\s*#\d+/.test(body)
    )
      missing.push("Parent Feature Issue must include a reference like #123");
  }

  if (issueType === "test") {
    if (!hasHeading("### Test Scope Type"))
      missing.push("Test Scope Type heading missing");
    if (!hasHeading("### Related Planning Issues"))
      missing.push("Related Planning Issues heading missing");
    else {
      const idx = body.indexOf("### Related Planning Issues");
      const sub = body.slice(idx);
      if (!/#\d+/.test(sub))
        missing.push(
          "At least one issue reference required under Related Planning Issues"
        );
    }
  }

  return missing;
};
