/**
 * Infer GitHub issue type from labels, title, or body.
 * Used by planning validation workflows to centralize type detection.
 */

module.exports.getIssueType = function(labelNames, issueTitle) {
  if (labelNames.includes("epic") || /^Epic\s*:/i.test(issueTitle)) {
    return "epic";
  }
  if (labelNames.includes("feature") || /^Feature\s*:/i.test(issueTitle)) {
    return "feature";
  }
  if (labelNames.includes("user-story") || /^Story\s*:/i.test(issueTitle)) {
    return "story";
  }
  if (labelNames.includes("enabler") || /^Enabler\s*:/i.test(issueTitle)) {
    return "enabler";
  }
  if (labelNames.includes("test") || /^Test\s*:/i.test(issueTitle)) {
    return "test";
  }
  return null;
};
