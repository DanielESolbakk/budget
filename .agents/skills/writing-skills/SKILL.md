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
Concrete method with steps to follow (condition-based-waiting, root-cause-tracing)

### Pattern
Way of thinking about problems (flatten-with-flags, test-invariants)

### Reference
API docs, syntax guides, tool documentation (office docs)

## Directory Structure


```
skills/
  skill-name/
    SKILL.md              # Main reference (required)
    supporting-file.*     # Only if needed
  ```

**Separate files for:**
1. **Heavy reference** (100+ lines) - API docs, comprehensive syntax
2. **Reusable tools** - Scripts, utilities, templates

**Keep inline:**
- Principles and concepts
- Code patterns (< 50 lines)
- Everything else

## SKILL.md Structure

**Frontmatter (YAML):**
- Two required fields: `name` and `description` (see [agentskills.io/specification](https://agentskills.io/specification) for all supported fields)
- Max 1024 characters total
- `name`: Use letters, numbers, and hyphens only (no parentheses, special chars)
- `description`: Third-person, describes ONLY when to use (NOT what it does)
  - Start with "Use when..." to focus on triggering conditions
  - Include specific symptoms, situations, and contexts
  - **NEVER summarize the skill's process or workflow** (see SDO section for why)
  - Keep under 500 characters if possible

```markdown
---
name: Skill-Name-With-Hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## When to Use
[Small inline flowchart IF decision non-obvious]

Bullet list with SYMPTOMS and use cases
When NOT to use

## Core Pattern (for techniques/patterns)
Before/after code comparison

## Quick Reference
Table or bullets for scanning common operations

## Implementation
Inline code for simple patterns
Link to file for heavy reference or reusable tools

## Common Mistakes
What goes wrong + fixes

## Real-World Impact (optional)
Concrete results
```

## Skill Discovery Optimization (SDO)

**Critical for discovery:** Future agents need to FIND your skill

### 1. Rich Description Field

**Purpose:** Your agent reads the description to decide which skills to load for a given task. Make it answer: "Should I read this skill right now?"

**Format:** Start with "Use when..." to focus on triggering conditions

**CRITICAL: Description = When to Use, NOT What the Skill Does**

The description should ONLY describe triggering conditions. Do NOT summarize the skill's process or workflow in the description.

**Why this matters:** Testing revealed that when a description summarizes the skill's workflow, an agent may follow the description instead of reading the full skill content. A description saying "code review between tasks" caused an agent to do ONE review, even though the skill's flowchart clearly showed TWO reviews (spec compliance then code quality).

When the description was changed to just "Use when executing implementation plans with independent tasks" (no workflow summary), the agent correctly read the flowchart and followed the two-stage review process.

**The trap:** Descriptions that summarize workflow create a shortcut agents will take. The skill body becomes documentation agents skip.

```yaml
# ❌ BAD: Summarizes workflow - agents may follow this skill instead of reading it
description: Use when executing plans - dispatches subagent per task with code review between tasks

# ❌ BAD: Too much process detail
description: Use for TDD - write test first, watch it fail, write minimal code, refactor

# ✅ GOOD: Just triggering conditions - no workflow summary
description: Use when executing implementation plans with independent tasks

# ✅ GOOD: Triggering conditions only
description: Use when implementing any feature or bugfix, before writing implementation code
```

**Content:**
- Use concrete triggers, symptoms, and situations that signal this skill applies
- Describe the *problem* (race conditions, inconsistent behavior) not *language-specific symptoms* (setTimeout, sleep)
- Keep triggers technology-agnostic unless the skill itself is technology-specific
- If skill is technology-specific, make that explicit in the trigger
- Write in third person (injected into system prompt)
- **NEVER summarize the skill's process or workflow**

```yaml
# ❌ BAD: Too abstract, vague, doesn't include when to use
description: For async testing

# ❌ BAD: First person
description: I can help you with async tests when they're flaky

# ❌ BAD: Mentions technology but skill isn't specific to it
description: Use when tests use setTimeout/sleep and are flaky

# ✅ GOOD: Starts with "Use when", describes problem, no workflow
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently

# ✅ GOOD: Technology-specific skill with explicit trigger
description: Use when using React Router and handling authentication redirects
```

### 2. Keyword Coverage

Use words an agent would search for:
- Error messages: "Hook timed out", "ENOTEMPTY", "race condition"
- Symptoms: "flaky", "hanging", "zombie", "pollution"
- Synonyms: "timeout/hang/freeze", "cleanup/teardown/afterEach"
- Tools: Actual commands, library names, file types

### 3. Descriptive Naming

Use active voice, verb-first:
- `creating-skills` not `skill-creation`
- `condition-based-waiting` not `async-test-helpers`

### 4. Token Efficiency (Critical)

**Problem:** getting-started and frequently-referenced skills load into EVERY conversation. Every token counts.

**Target word counts:**
- getting-started workflows: <150 words each
- Frequently-loaded skills: <200 words total
- Other skills: <500 words (still be concise)

**Techniques:**

**Move details to tool help:**
```bash
# BAD: Document all flags in SKILL.md
search-conversations supports --text, --both, --after DATE, --before DATE, --limit N

# GOOD: Reference --help
search-conversations supports multiple modes and filters. Run --help for details.
```

**Use cross-references:**
```markdown
# BAD: Repeat what's in another skill
When searching, dispatch subagent with template...
[20 lines of repeated instructions]

# GOOD: Reference other skill
Always use subagents. REQUIRED: Use test-driven-development for the workflow.
```

**Compress examples:**
```markdown
# BAD: Verbose example (42 words)
Your human partner: "How did we handle authentication errors in React Router before?"
You: I'll search past conversations for React Router authentication patterns.
[Dispatch subagent with search query: "React Router authentication error handling 401"]

# GOOD: Minimal example (20 words)
Partner: "How did we handle auth errors in React Router?"
You: Searching...
[Dispatch subagent → synthesis]
```

**Eliminate redundancy:**
- Don't repeat what's in cross-referenced skills
- Don't explain what's obvious from command
- Don't include multiple examples of the same pattern

**Verification:**
```bash
wc -w skills/path/SKILL.md
# getting-started workflows: aim for <150 each
# Other frequently-loaded skills: aim for <200 total
```

**Name by what you DO or core insight:**
- `condition-based-waiting` > `async-test-helpers`
- `using-skills` > `skill-usage`
- `flatten-with-flags` > `data-structure-refactoring`
- `root-cause-tracing` > `debugging-techniques`

**Gerunds (-ing) work well for processes:**
- `creating-skills`, `testing-skills`, `debugging-with-logs`
- Active, describes the action you're taking

### 5. Cross-Referencing Other Skills

When writing documentation that references other skills, use skill name only with explicit requirement markers:
- **REQUIRED SUB-SKILL:** Use superpowers:test-driven-development
- **REQUIRED BACKGROUND:** You MUST understand superpowers:systematic-debugging
- Do not use file paths to imply a required skill, and do not use force-load syntax.

## Flowchart Usage

Use a small inline flowchart only when a decision is non-obvious. Avoid flowcharts for reference material, code examples, linear instructions, or generic labels. See `graphviz-conventions.dot` in this directory for style rules.

**Visualizing for your human partner:** Use `render-graphs.js` in this directory to render a skill's flowcharts to SVG.

## Code Examples

Use one excellent example in the most relevant language. It should be complete, runnable, and explain why. Avoid multi-language dilution, fill-in-the-blank templates, and contrived examples.

## File Organization

Use a self-contained SKILL.md unless content is a heavy reference or reusable tool. Supporting files are for those cases only.

Invoke bundled scripts through their interpreter, never by bare path; executable bits can be stripped by harness packaging.

## The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to new skills and edits to existing skills.

**No exceptions:**
- Not for simple additions or documentation changes
- Don't keep untested changes as reference
- Don't adapt untested guidance while writing tests

## Testing All Skill Types

### Discipline-Enforcing Skills

Test with academic questions and pressure scenarios combining at least three pressures (time, sunk cost, authority, exhaustion, social, or pragmatic). Capture rationalizations and add counters for those observed.

### Technique Skills

Test application, variation, and missing-information scenarios.

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

## Match the Form to the Failure

| Failure observed | Form that fits |
|------------------|----------------|
| Rule skipped under pressure | Prohibition + observed rationalization + red flag |
| Output has wrong shape | Positive recipe with required parts and order |
| Required element omitted | Required field or template slot |
| Behavior depends on a condition | Conditional based on an observable predicate |

Avoid nuance clauses that reopen a loophole. State exceptions as separate observable conditions.

## RED-GREEN-REFACTOR for Skills

### RED: Baseline

Run a pressure scenario with a subagent that does not have the skill. Record its choice and verbatim rationale. If the control does not exhibit the failure, do not write guidance for that failure; redesign the scenario or stop.

### GREEN: Minimal Guidance

Address observed behavior only. Repeat the same scenario with the complete skill loaded.

### REFACTOR: Close Observed Gaps

If the agent fails or introduces a new rationalization, change only the relevant guidance and rerun the failed scenario. Do not rerun scenarios that already pass unless the change affects them.

### Risk-Based Validation Depth

Classify each changed behavior separately; mixed edits use the tier for each behavior.

- **Focused maintenance:** one no-skill baseline and one guided rerun of the same scenario. Stop on a clean, cited result.
- **New or high-impact rule:** add one independent transfer scenario, even after a passing baseline/guided pair.
- **Inconsistent or repeated failures:** expand to five independent samples per variant and read every flagged result manually.

Each discipline scenario combines at least three pressures. A deadline changes redundant repetition, not the RED/GREEN requirement.

## Terminal Failures and Cleanup Safety

This applies during skill tests and deployment.

- Run one-shot commands synchronously; record command, output, and exit code. A harness failure before assertions is neither a passing nor failing behavior test.
- In PowerShell, use `npm.cmd` if `npm.ps1` is blocked. If Electron setup fails with `spawnSync npm.cmd EINVAL` before assertions, run the build prerequisite separately and rerun the focused test.
- For prompts, use the returned terminal ID and send one answer at a time. If no ID is available, do not answer through another terminal; ask the user to cancel that exact prompt and wait for the shell to return.
- Inspect junctions/symlinks and identify their targets before cleanup. Never choose Yes for recursive deletion of a shared target; answer No and stop the chain, or ask the user to cancel in place if the session cannot be targeted.
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
