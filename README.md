# Lean Codex instructions

A stack-neutral setup with one default workflow and two optional role prompts.

## Setup
Copy `AGENTS.md` to your repository root and `agents/` alongside it. If your repository already has an `AGENTS.md`, merge the relevant rules instead of replacing it. Keep `README.md` as a reference if useful.

The role files are ordinary Markdown prompts. Request a role explicitly; they do not register custom agents or configure automatic delegation.

## Example requests
- Implement: "Read agents/implementer.md and implement [feature]. Follow AGENTS.md."
- Debug: "Read agents/implementer.md and fix [bug]. Reproduce the issue and verify the fix."
- Review: "Read agents/reviewer.md and review [diff or branch]. Report actionable findings; do not edit files."

## Adaptation
Add only project-specific facts that help execution: the stack, actual test/build commands, architectural boundaries, and important compatibility requirements. Keep instructions short and update them when project behavior changes.

Use the default workflow for routine tasks. Bring in a separate review when the scope or risk warrants it. No dedicated planner or test agent is required.
