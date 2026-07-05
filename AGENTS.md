# AGENTS.md — Operating Rules for the Dragons Project

This file governs how every agent (and human) works in this repo. Read it fully before doing any task.

## 1. Project in one paragraph

We are building a Minecraft mod that adds **dragon pets** whose 3D models are **procedurally generated from a set of traits** and **evolve over time** (growth) via a rule-based iterate-step function: `state[n+1] = grow(state[n], params, environment)`. Before touching Minecraft, we build a **standalone test bed** to explore model-generation approaches, render them, and tune them with human + AI (grok vision) feedback. Wild dragons may use fixed models; only tamed **pets** (≤ ~10 per server) use the expensive evolving models, which bounds the CPU/memory budget. Long-term features: taming, feeding, care, training (all affecting appearance), breeding (combine two dragons' params into an egg/baby), and **expressive cartoon faces** (steerable eyes + floating brows) that read clear emotions.

See `README.md` for the full vision and `docs/roadmap.md` for phases.

## 2. The prime directive for sub-agents: the 35% rule

**Any non-main (sub-agent) task must stop at ~35% context-window utilization.** When you approach that limit:

1. Write a **resume file** to `.agents/resume/<task-slug>.md` (template in §6).
2. Commit your work-in-progress (see §4).
3. Stop and return a short summary to the orchestrator, pointing at the resume file.

Do **not** try to finish a large task in one shot by compressing. Partial + resumable beats rushed + complete. A follow-up session will pick up from the resume file with a clean context.

Estimate your utilization honestly: if you've read many large files or done many tool calls and your working memory feels heavy, you are probably near the limit — checkpoint.

## 3. Git & worktrees

- Single repo. `main` is the integration branch.
- **Every build/code task runs in its own git worktree** so parallel agents never collide:
  ```
  git worktree add ../dragons-wt/<task-slug> -b <task-slug>
  ```
  Work there, commit, then the orchestrator merges to `main`.
- **Research/writing tasks** that only add new files under `research/` or `design/` may work directly on `main` **if** each writes to its own distinct file (no shared-file edits) — no worktree needed.
- Never force-push. Never rewrite `main` history.
- Keep commits small and labeled with the task slug: `feat(testbed): ...`, `research(growth): ...`.

## 4. Committing

- Commit early and often; a checkpoint commit before stopping is mandatory.
- Commit message footer:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- Do not commit large binaries (rendered PNGs, glTF dumps) unless they are curated reference assets. Renders belong in `testbed/out/` which is gitignored; promote keepers to `art/reference/`.

## 5. Using the `grok` CLI (image gen + vision)

`grok` is a separate model available on this machine. Use it for art asset generation and as a **second-opinion vision evaluator**. Helper script: `./tools/grok.sh` (wraps the flags below).

- **Image generation** (textures, concept art, reference sheets):
  ```
  grok --always-approve -p "Generate <description>. Save to <abs path>.png. Reply with the path only."
  ```
- **Vision / quality evaluation** of a render (glitches, gaps, bad corners, aesthetics):
  ```
  grok --always-approve -p "Analyze the image at <abs path>. Rate 1-10 for: (a) geometric correctness (no gaps/holes/inverted faces/bad corners), (b) style consistency, (c) expressiveness, (d) overall appeal. Give one concrete fix. Reply as JSON."
  ```
- Use `--json-schema '<schema>'` for structured evaluation output you can parse.
- `grok` is the *evaluator/generator of assets*; **Claude Read** is the primary vision check inside agents. Cross-check with grok for a second opinion, especially on "does this look good / cute / cool / on-model".
- Drop to **Opus 4.8** (`model: opus` on the Agent tool, or a different worker model) for heavy build/reasoning tasks where it earns its cost. Keep cheap/mechanical passes on smaller models.

## 6. Resume-file template

Write to `.agents/resume/<task-slug>.md`:

```markdown
# Resume: <task title>
Status: IN_PROGRESS | BLOCKED | DONE
Branch/worktree: <name or "main">
Last commit: <sha + subject>

## Goal
<one paragraph>

## Done so far
- ...

## Next steps (in order)
1. ...

## Key files
- path — what it is

## Open questions / decisions needed from orchestrator
- ...

## Context notes
<anything a fresh agent must know that isn't obvious from the code>
```

## 7. Deliverable conventions

- Research → `research/<topic>.md`. Start with a **TL;DR (5 bullets)**, then findings, then a **"Recommendation for our project"** section, then sources with links.
- Design → `design/<topic>.md`.
- Test-bed code → `testbed/`. Must be runnable standalone (no Minecraft dependency) and must render to images for evaluation.
- Prefer clarity over cleverness; match existing code style; comment only non-obvious constraints.

## 8. Feasibility guardrails (keep these in mind)

- Target: ≤ ~10 fully-evolving pet models per server. Wild dragons = fixed models.
- Growth step should be cheap and incremental; cache the current mesh, only recompute on growth ticks (not every frame).
- The model representation must be serializable (for save/load, breeding, and network sync) and reconstructable from a compact **genome** (the traits), not stored as raw meshes.
- Faces: eyes + brows are a reusable, scalable sub-rig layered onto any generated head.
