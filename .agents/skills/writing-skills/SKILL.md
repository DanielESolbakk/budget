---
name: writing-skills
description: Use when creating or editing agent skills, validating their behavior, or resolving test and terminal failures encountered during skill testing or deployment
---

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

Repository skills live under `.agents/skills/` and are available to agents in this workspace. Runtime-specific personal skill paths vary.

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes). 

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

**REQUIRED BACKGROUND:** You MUST understand superpowers:test-driven-development before using this skill. That skill defines the fundamental RED-GREEN-REFACTOR cycle. This skill adapts TDD to documentation.

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help future agents find and apply effective approaches.

**Skills are:** Reusable techniques, patterns, tools, reference guides

**Skills are NOT:** Narratives about how you solved a problem once

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (SKILL.md) |
| **Test fails (RED)** | Agent violates rule without skill (baseline) |
| **Test passes (GREEN)** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |
| **Write test first** | Run baseline scenario BEFORE writing skill |
| **Watch it fail** | Document exact rationalizations agent uses |
| **Minimal code** | Write skill addressing those specific violations |
| **Watch it pass** | Verify agent now complies |
| **Refactor cycle** | Find new rationalizations → plug → re-verify |

The entire skill creation process follows RED-GREEN-REFACTOR.

## When to Create a Skill

**Create when:**
- Technique wasn't intuitively obvious to you
- You'd reference this again across projects
- Pattern applies broadly (not project-specific)
- Others would benefit

**Don't create for:**
- One-off solutions
- Standard practices well-documented elsewhere
- Project-specific conventions (put in your instructions file)
- Mechanical constraints (if it's enforceable with regex/validation, automate it—save documentation for judgment calls)

## Skill Types

### Technique
Concrete method and steps (condition-based-waiting, root-cause-tracing)

### Pattern
A way of thinking (flatten-with-flags, test-invariants)

### Reference
API docs, syntax guides, tool documentation (office docs)

## Directory Structure

```
skills/
  skill-name/
    SKILL.md
    supporting-file.*
```

**Separate files for:**
1. Heavy references (100+ lines)
2. Reusable tools, scripts, templates

**Keep inline:** Principles, concepts, code patterns under 50 lines, and everything else that is not a heavy reference or reusable tool.

## SKILL.md Structure

**Frontmatter (YAML):**
- Required: `name` and `description` (see [agentskills.io/specification](https://agentskills.io/specification))
- Max 1024 characters total
- `name`: letters, numbers, and hyphens only
- `description`: third person, starts with "Use when...", describes triggers only, and stays under 500 characters where possible

```markdown
---
name: Skill-Name-With-Hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
Core principle in 1-2 sentences.

## When to Use
Triggers, symptoms, and when not to use.

## Core Pattern (techniques/patterns)
Before/after comparison.

## Quick Reference
Table or bullets for scanning common operations.

## Implementation
Inline code for simple patterns; link to heavy references or reusable tools.

## Common Mistakes
What goes wrong and the fix.

## Real-World Impact (optional)
Concrete results.
```

## Skill Discovery Optimization (SDO)

**Critical for discovery:** Future agents need to find the skill.

### 1. Rich Description Field

The description answers: "Should I read this skill right now?" It contains triggering conditions only, never a process summary.

**Why:** A process summary can become a shortcut that agents follow instead of reading the complete skill. Testing showed that "code review between tasks" led an agent to do one review despite the body requiring two stages.

```yaml
# BAD: summarizes workflow
description: Use when executing plans - dispatches a subagent per task with reviews

# GOOD: describes a trigger only
description: Use when executing implementation plans with independent tasks
```

### 2. Keyword Coverage

Include concrete triggers and searchable terms:
- Error messages: "Hook timed out", "ENOTEMPTY", "race condition"
- Symptoms: flaky, hanging, zombie, pollution
- Synonyms: timeout/hang/freeze, cleanup/teardown/afterEach
- Tools: actual commands, libraries, and file types

Describe the problem rather than language-specific symptoms, unless the skill is technology-specific.

### 3. Naming

Use active voice and descriptive, verb-first names. Gerunds work well for processes: `creating-skills`, `testing-skills`, `debugging-with-logs`.

### 4. Token Efficiency

Frequently loaded skills have a target under 200 words; other skills should stay under 500 where possible. Eliminate repetition, compress examples, refer to tool help for flags, and link to another skill instead of duplicating its workflow.

**Name the action or core insight:** `condition-based-waiting` over `async-test-helpers`; `flatten-with-flags` over `data-structure-refactoring`.

### 5. Cross-Referencing Other Skills

Use skill names with explicit requirement markers:
- **REQUIRED SUB-SKILL:** Use superpowers:test-driven-development
- **REQUIRED BACKGROUND:** You MUST understand superpowers:systematic-debugging

Do not use file paths to imply a requirement or force-load syntax.

## Flowchart Usage

Use a small inline flowchart only for a non-obvious decision. Do not use flowcharts for reference material, code examples, linear instructions, or generic labels. See `graphviz-conventions.dot` for conventions.

For human-readable SVGs, use `node ./render-graphs.js ../some-skill` or add `--combine`.

## Code Examples

Use one excellent example in the most relevant language. It should be complete, runnable, and explain why. Avoid multi-language examples, fill-in-the-blank templates, and contrived examples.

## File Organization

Use a self-contained SKILL.md unless content is a heavy reference or reusable tool. Invoke bundled scripts through their interpreter (for example, `node scripts/tool.js`), never by bare path.

## The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to new skills and edits. No exceptions for simple additions or documentation changes. Do not keep untested changes as reference or adapt guidance while writing tests.

**REQUIRED BACKGROUND:** Understand superpowers:test-driven-development; it defines RED-GREEN-REFACTOR.

## Testing All Skill Types

### Discipline-Enforcing Skills

Use academic checks and pressure scenarios with at least three combined pressures (time, sunk cost, authority, exhaustion, social, or pragmatic). Capture exact choices and rationalizations, then address observed behavior.

### Technique Skills

Test application, variation, and missing-information cases.

### Pattern Skills

Test recognition, application, and counter-examples.

### Reference Skills

Test retrieval and application.

## Common Rationalizations for Skipping Testing

| Excuse | Reality |
|--------|---------|
| "Skill is obviously clear" | Clear to you does not mean clear to other agents. Test it. |
| "It's just a reference" | Test retrieval and use, not only readability. |
| "I'll test after" | Baseline behavior reveals what guidance must prevent. |
| "No time to test" | Reduce redundant repetitions, never remove RED or GREEN. |
| "Five reps for every edit is wasteful" | Keep five for high-risk or inconsistent outcomes; use the risk-based minimum otherwise. |
| "I can keep working after declining a terminal prompt" | A declined prompt does not cancel a command chain. Stop and inspect state. |
| "The prompt is outside skill scope" | Terminal prompts during skill testing or deployment are part of the workflow. |

**Testing before deployment is mandatory.**

## Match the Form to the Failure

| Failure observed | Form that fits |
|------------------|----------------|
| Rule skipped under pressure | Prohibition, observed rationalization, and red flag |
| Output has wrong shape | Positive recipe with required parts and order |
| Required element omitted | Required field or template slot |
| Behavior depends on a condition | Conditional based on an observable predicate |

Avoid nuance clauses that reopen a loophole. State exceptions as separate observable conditions.

## Bulletproofing Skills Against Rationalization

For discipline failures, capture specific workarounds and add counters. For wrong-shaped output or omissions, use positive recipes or required slots rather than prohibition lists.

### Close Every Loophole Explicitly

Bad:
```markdown
Write code before test? Delete it.
```

Good:
```markdown
Write code before test? Delete it. Start over.

No exceptions:
- Don't keep it as reference
- Don't adapt it while writing tests
- Don't look at it
```

### Address Spirit-versus-Letter Arguments

State early that violating the letter violates the spirit. Add exact rationalizations from baseline runs to the table and red flags.

## RED-GREEN-REFACTOR for Skills

### RED: Baseline

Run a pressure scenario with a subagent that does not have the skill. Record its choice and verbatim rationale. If the control does not exhibit the failure, redesign the scenario or stop; do not author guidance for that failure.

### GREEN: Minimal Guidance

Address observed behavior only. Rerun the same scenario with the complete skill loaded.

### REFACTOR: Close Observed Gaps

If the agent fails or introduces a new rationalization, change only the relevant guidance and rerun that failed scenario. Do not rerun passing scenarios unless the edit affects them.

### Risk-Based Validation Depth

Classify each changed behavior separately; mixed edits use the tier for each behavior.

- **Focused maintenance:** one no-skill baseline and one guided rerun of the same scenario. Stop on a clean, cited result.
- **New or high-impact rule:** add one independent transfer scenario, even after a passing baseline/guided pair.
- **Inconsistent or repeated failures:** expand to five independent samples per variant and read every flagged result manually.

Each discipline scenario combines at least three pressures. A deadline reduces redundant repetitions, not RED/GREEN.

## Terminal Failures and Cleanup Safety

This applies during skill tests and deployment.

- Run one-shot commands synchronously and record command, output, and exit code. A harness failure before assertions is neither a passing nor failing behavior test.
- In PowerShell, use `npm.cmd` if `npm.ps1` is blocked. If Electron setup fails with `spawnSync npm.cmd EINVAL` before assertions, run the build prerequisite separately and rerun the focused test.
- For prompts, use the returned terminal ID and send one answer at a time. If no ID is available, do not answer through another terminal; ask the user to cancel that exact prompt and wait for the shell to return.
- Inspect junctions/symlinks and identify targets before cleanup. Never choose Yes for recursive deletion of a shared target; answer No and stop the chain, or ask the user to cancel in place if the session cannot be targeted.
- Do not run `git worktree remove --force` while a shared junction remains. Do not assume omitting `-Recurse` makes removal link-only. Use only a verified non-following unlink operation and confirm the target remains; if uncertain, leave cleanup to the owner.

Red flags: skipping RED/GREEN under deadline; choosing Yes for recursive junction deletion; continuing after declining a prompt; claiming a test passed when assertions never ran.

## STOP: Before Moving to Next Skill

After writing or editing a skill, finish validation for that skill before starting another. Do not batch skill changes or skip testing to save time.

## Skill Creation Checklist (TDD Adapted)

Track RED, GREEN, REFACTOR, and deployment phases as todos. Expand per-item tasks only for multi-scenario work, long-running checks, or blockers; still review every applicable checklist item.

**RED Phase:**
- [ ] Create pressure scenarios with at least three combined pressures for discipline skills.
- [ ] Run scenarios without the skill and record baseline behavior.
- [ ] Identify observed rationalizations.

**GREEN Phase:**
- [ ] Validate frontmatter and trigger-only description.
- [ ] Address observed failures with the correct guidance form.
- [ ] Keep examples concise and use existing references where suitable.
- [ ] Run the same pressure scenario with the skill loaded.

**REFACTOR Phase:**
- [ ] Look for new rationalizations and add specific counters.
- [ ] Rerun failed scenarios only; retain passing scenarios unless affected.
- [ ] Use five independent samples per variant when results vary or the consequence warrants it.

**Quality and Deployment:**
- [ ] Review flowchart, quick-reference, common-mistake, and file-organization needs.
- [ ] Validate the skill and commit/publish through the repository's PR workflow.

## Discovery Workflow

How future agents find your skill:

1. Encounters problem (for example, flaky tests).
2. Searches skill descriptions or categories.
3. Finds a matching skill.
4. Scans the overview.
5. Reads the relevant pattern.
6. Loads examples only when implementing.

Optimize this discovery flow with searchable, trigger-focused wording.
