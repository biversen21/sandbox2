# Working Rules

## Branch Protection

- `main` is the protected source-of-truth branch.
- No direct commits to `main` under any circumstance.
- All implementation work must happen on feature branches branched from `main`.

## Milestone Delivery

- Each milestone must be delivered as a separate pull request.
- Each PR must be small, reviewable, and tied to exactly one milestone.
- Do not begin the next milestone until the current PR has been reviewed and approved.

## Scope Discipline

- Do not install dependencies, scaffold the app, or write implementation code
  unless the current milestone explicitly asks for it.
- If requirements are unclear, stop and ask before coding.
- Do not add features, refactoring, or abstractions beyond what the current
  milestone specifies.

## Pre-PR Checklist

Before opening any PR:
- Run all relevant validation checks (linting, type checking, tests as applicable).
- Document the results of those checks in the PR description.

## PR Description Requirements

Every PR must include:

1. **What changed** — a concise summary of the files and logic affected.
2. **Why it changed** — the milestone or decision that motivated the change.
3. **How to test** — explicit steps to verify the change works as intended.
4. **Known limitations** — anything intentionally deferred or incomplete.
