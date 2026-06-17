/**
 * Infer GitHub issue type from labels or title.
 * Kept as CommonJS so github-script can load it inside a type=module repo.
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