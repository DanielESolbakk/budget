# Issue Templates

Use these templates when rewriting issue bodies. Keep section headings exact and issue references as bullet items.

## Global Formatting Rules

- Use `###` section headings for structured blocks.
- In reference sections, use only `- #123` style bullet references.
- Do not use inline references like `#123, #124` in structured section bodies.
- Keep wording direct and deterministic.

## Feature Issue Template

```markdown
### Parent Epic Issue

- #EPIC

### Parent Feature Issue

- _None_

### Feature Description

[One concise paragraph]

### User Stories In This Feature

- [ ] [Story-level user intent 1]
- [ ] [Story-level user intent 2]

### Technical Enablers

- #ENABLER

### Test Issues In This Feature

- #TEST

### Related Planning Issues

- #SIBLING_FEATURE or _None_

### Implementation Entry Points

- [existing path]

### Validation Commands

- [command]

### Fixture Or Example Inputs

- [fixture]

### Out Of Scope

- [explicit exclusions]

### Test Automation Triangle Coverage

- Unit: [issue or deferred follow-up issue]
- Integration: [issue or deferred follow-up issue]
- Playwright/end-to-end: [issue or deferred follow-up issue]

### Dependencies

#### Blocks

- [optional]

#### Blocked by

- #BLOCKER

### Acceptance Criteria

- [ ] AC-1: [specific]
- [ ] AC-2: [specific]

### Acceptance Criteria To Test Mapping

- AC-1 | [test-level] | #TEST_ISSUE | [test-file-path]
- AC-2 | [test-level] | #TEST_ISSUE | [test-file-path]
```

## Story Issue Template

```markdown
### Parent Epic Issue

- #EPIC

### Parent Feature Issue

- #FEATURE

### Story Statement

[As a..., I want..., so that...]

### Acceptance Criteria

- [ ] AC-1: [specific]
- [ ] AC-2: [specific]

### Technical Tasks

- [ ] [task]

### Implementation Entry Points

- [existing path]

### Validation Commands

- [command]

### Fixture Or Example Inputs

- [fixture]

### Out Of Scope

- [exclusions]

### Testing Requirements

- Unit: [issue or deferred follow-up]
- Integration: [issue or deferred follow-up]
- Playwright/end-to-end: [issue or deferred follow-up]

### Linked Enabler Issues

- #ENABLER

Note: if repository validation requires this section to be non-empty, do not use `_None_`; link at least one feature-scoped enabler issue.

### Linked Test Issues

- #TEST

### Dependencies

#### Blocked by

- #BLOCKER
```

## Enabler Issue Template

```markdown
### Parent Epic Issue

- #EPIC

### Parent Feature Issue

- #FEATURE

### Enabler Description

[what shared capability is provided]

### Stories Enabled

- #STORY

### Related Planning Issues

- #RELATED

### Technical Requirements

- [ ] [specific requirement]

### Technical Tasks

- [ ] [concrete implementation step with file/module reference]
- [ ] [create new file or integration point]

### Implementation Entry Points

- [existing path]

### Validation Commands

- [command]

### Fixture Or Example Inputs

- [fixture or N/A]

### Out Of Scope

- [exclusions]

### Acceptance Criteria

- [ ] AC-1: [specific]

### Acceptance Criteria To Test Mapping

- AC-1 | [test-level] | #TEST_ISSUE | [test-file-path]

### Dependencies

#### Blocked by

- #BLOCKER
```

## Test Issue Template

```markdown
### Parent Epic Issue

- #EPIC

### Test Scope Type

- Story or Enabler

### Parent Feature Issue

- #FEATURE

### Parent Story Or Enabler Issue

- #PARENT

### Related Planning Issues

- #FEATURE
- #PARENT

### Parent AC IDs Covered

- AC-1

### Test Level

- Unit

### Test Objective

[clear objective]

### Preconditions

- Runtime/product behavior under test already exists in implementation issues or delivered code.
- If missing `src/`, `electron/`, `preload`, IPC, or renderer behavior is discovered, stop and create or link a story/enabler issue instead of expanding this test issue.

### Technical Tasks

- [ ] [task, including file creation when needed]

### Implementation Entry Points

- [existing path]

### Validation Commands

- [command]

### Fixture Or Example Inputs

- [fixture]

### Test Scenarios

- [ ] Scenario 1: [specific]

### Pass Criteria

- [ ] AC-1: [specific]

### Out Of Scope

- [exclusions]

### Regression Guard

- [ ] [regression expectation]
```
