# plos — Capability Audit (2026-09-20)

> Ground-truth audit of what is actually installed/available in this Claude
> Code environment, run before any architecture or product artifact was
> created, per the user's explicit instruction: *"Claude first installs/
> audits the relevant capabilities, then establishes the project operating
> system, and only then is allowed to create product artifacts or code."*
> The enforceable rules derived from this audit live in
> [`CLAUDE.md`](../CLAUDE.md); this file is the evidence trail.

## 1. Two separate capability systems exist here — don't conflate them

1. **Local CLI plugin system** (`~/.claude/plugins/`, managed by `/plugin`
   in an interactive terminal). Ground truth from
   `known_marketplaces.json` / `installed_plugins.json`:
   - Only marketplace registered: `claude-plugins-official`
     (`anthropics/claude-plugins-official`).
   - Only plugin installed: `swift-lsp@claude-plugins-official` (Swift
     language server — code intelligence only, no design guidance).
   - **I cannot add marketplaces or install plugins from this session** —
     `/plugin` is an interactive terminal dialog, and this session is
     non-interactive. Any plugin addition is an action item for the user
     to run themselves in an interactive `claude` terminal.
2. **claude.ai account-level skills/plugins** (enabled on your account,
   available in every Code session regardless of project) — a much larger,
   already-active surface: the `yuval-skills:*` marketplace (~90 skills),
   `anthropic-skills:*`, plus `small-business`/`operations`/`finance`/
   `sales` marketplaces (business-function skills, not relevant to plos).
   These are already loaded and usable right now with the `Skill` tool —
   no install step needed.

The pasted recommendation list mixed both systems together and cited two
different repo owners for the same "Everything Claude Code" plugin
(`affaan-m/...` in one link, `hssling/...` in another) — a sign the source
list itself should be treated as unverified, not authoritative. Every
recommendation below was checked against real evidence, not re-quoted.

## 2. What the official marketplace already has (verified via local cache)

`claude-plugins-official` is already registered, so anything in it is one
`/plugin install <name>@claude-plugins-official` away — no new marketplace
trust decision required. Relevant finds (full list of ~350 plugins scanned):

| Plugin | What it does | Replaces which pasted recommendation |
|---|---|---|
| `superpowers` | "Teaches Claude brainstorming, subagent driven development with built-in code review, systematic debugging, and red/green TDD... how to author and test new skills." | **obra/superpowers** — this is that same lineage, vendored into the Anthropic-curated marketplace, not a random GitHub source |
| `ralph-loop` | "Interactive self-referential AI loops for iterative development... Claude works on the same task repeatedly, seeing its previous work, until completion" | **maxmilian/loop-engineering** |
| `frontend-design` | "Create distinctive, production-grade frontend interfaces... avoids generic AI aesthetics" | **Anthropic frontend-design** ask — exact match, already available |
| `plugin-dev` | "Comprehensive toolkit for developing Claude Code plugins... 7 expert skills covering hooks, MCP integration, commands, agents" | **Anthropic plugin-dev** ask — exact match |
| `claude-code-setup` | "Analyze codebases and recommend tailored Claude Code automations... hooks, skills, MCP servers, subagents" | **Anthropic claude-code-setup** ask — exact match (this is literally the tool that would do this audit for you automatically next time) |
| `feature-dev`, `code-review`, `code-simplifier`, `pr-review-toolkit` | Specialized agents for codebase exploration, architecture design, quality review, simplification | Covers most of **sethdford/claude-skills "Business/Engineering System"** |
| `claude-security`, `security-guidance`, `semgrep`, `sonarqube`, `42crunch-api-security-testing`, `nightvision`, `aikido` | Vulnerability scanning, SAST, secrets scanning, DAST, API security | Covers **sethdford security skills**, with more options and Anthropic/vendor backing |
| `claude-md-management` | "Audit quality, capture session learnings, and keep project memory current" for CLAUDE.md files | Directly useful for maintaining *this* operating-system doc over time |
| `remember` | "Continuous memory for Claude Code... tiered daily logs" | Alternative to **d2a8k3u/claude-code-memory** — but see §4, the native memory system already active in this session supersedes both |

**Recommendation**: if/when any of these are wanted, install from the
already-trusted official marketplace (`/plugin install <name>@claude-plugins-official`)
rather than adding a new, unvetted marketplace for the same capability.

## 3. Account-level skills already covering the pasted recommendations

Checked against the live `yuval-skills:*` / `anthropic-skills:*` roster
(already enabled, no action needed):

| Pasted recommendation | Already covered by |
|---|---|
| Superpowers (think-before-doing) | `yuval-skills:using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans` |
| Agent Engineering (subagent delegation) | `yuval-skills:dispatching-parallel-agents`, `subagent-driven-development`, plus the native `Agent` and `Workflow` tools |
| Goal / Product Discovery Engineering | `yuval-skills:brainstorming`, `doc-coauthoring` |
| TDD / systematic debugging | `yuval-skills:test-driven-development`, `systematic-debugging` |
| Verification before claiming done | `yuval-skills:verification-before-completion` |
| Code review (giving/receiving) | `yuval-skills:requesting-code-review`, `receiving-code-review`, plus official `code-review` |
| Anti-slop | `yuval-skills:stop-slop` (prose), `ponytail-review`/`ponytail-audit` (over-engineering/bloat), official `code-simplifier` |
| Security review | **Correction (2026-09-21, verified via `ListSkills`): `yuval-skills:security-review` does not exist** — the actual capability used for Milestone 7's security pass, and the right one going forward, is the bundled `code-review` skill scoped at security-sensitive paths (it runs an 8-angle review incl. correctness/cleanup/altitude/conventions). `claude-security`/`semgrep`/`sonarqube` remain marketplace-available-not-installed (§2) for dedicated SAST/secrets scanning. |
| Backend / frontend / API patterns | `yuval-skills:backend-patterns`, `frontend-patterns`, `api-design`, `coding-standards` |
| Design system / UI | `yuval-skills:design`, `design-system`, `design-is`, `ui-styling`, `ui-ux-pro-max`, `frontend-design`, plus official `frontend-design`, `artifact-design` |
| Git worktrees for isolation | `yuval-skills:using-git-worktrees` |
| Codebase priming / search | `yuval-skills:learn-codebase`, `smart-explore` |
| Documentation lookups | `yuval-skills:documentation-lookup` (Context7-backed) |
| MCP/plugin building | `yuval-skills:mcp-builder`, `mcp-server-patterns`, official `mcp-server-dev`/`plugin-dev` |
| Testing | `yuval-skills:webapp-testing`, `e2e-testing` |
| Loop/orchestration engineering | Native **Workflow** tool + `workflow-authoring` skill (deterministic multi-agent pipelines — more capable than a "loop engineering" skill bundle) |
| Persistent memory | Native, already-active file-based memory system (`user`/`feedback`/`project`/`reference` types, described in this session's own system prompt) — **supersedes** both the `remember` plugin and `d2a8k3u/claude-code-memory` |

**Recommendation**: do not add `Everything Claude Code`, `ckorhonen/
claude-skills`, `sethdford/claude-skills`, `levnikolaevich/claude-code-
skills`, `SalZaki/antislop`, `shidoyu/scout`, `Scout-AI-Labs/scout-skills`,
`d2a8k3u/claude-code-memory`, or `strickvl/skills`. Every responsibility
they'd cover is already served, generally by something more vetted
(official marketplace or your own existing account skills), and stacking
near-duplicate skill sources is a real risk: overlapping/conflicting
instructions, plus each unvetted repo is untrusted code that can register
hooks (shell execution on tool events) — not something to add speculatively
for a project that will eventually hold health/financial/mental-health
data.

## 4a. Update (2026-09-20, later same day): partial install in progress

State changed since the original audit — checked directly against
`known_marketplaces.json` / `installed_plugins.json` again:

- `frontend-design@claude-plugins-official` is now installed and enabled.
  No concern — this was already the risk-free, exact-match recommendation
  from §2.
- The `indie-apple-stack` marketplace (`rshankras/claude-code-apple-skills`)
  was added and cloned to disk, but the `apple-skills` plugin itself was
  **not** installed/enabled yet — the marketplace-add step ran, the
  install step didn't. Remaining command:
  ```
  /plugin install apple-skills@indie-apple-stack
  ```
- Reading the now-cloned marketplace manifest directly
  (`.claude-plugin/marketplace.json`) resolved the open unknown from §4
  below: `apple-skills` is genuinely 164 skills across 23 categories,
  including testing/TDD, performance, security, and App Store/ASO — not
  just the 7 visual-design skills originally verified. Good to install as
  originally recommended.
- The same marketplace also exposes a **second, separate plugin**: `apple`
  (branded "SwiftShip"), sourced from a **different, unvetted repository**
  (`rshankras/SwiftShip.git`) — 53 `/apple:*` workflow commands **plus 6
  pinned agents** spanning idea validation through roadmap, build, review,
  TestFlight, and **App Store submission**. This was never part of what I
  verified (§4 below only assessed the skills-library repo), and agents
  reaching as far as store submission are a meaningfully higher-trust
  surface than a skill library. **Do not install `apple` alongside
  `apple-skills` on the strength of this audit** — it needs its own
  look (what do those 6 agents actually do, what do the submission-related
  commands touch) before it earns the same "install it" verdict.

## 4. The one verified, genuine gap: Apple HIG / platform design guidance

No installed capability (official marketplace or account skills) encodes
Apple Human Interface Guidelines specifics — SF Symbols, Dynamic Type,
44pt touch targets, VoiceOver, Reduce Motion, Liquid Glass, platform-
correct navigation per iOS/iPadOS/macOS/watchOS/visionOS. Given plos is
SwiftUI/iOS-first (product vision §50), this is real and worth closing —
but *when* UI work starts, not now (see `CLAUDE.md` phase gate).

Three candidates were fetched and verified directly (not trusted from the
pasted list):

| Repo | Verified reality | Verdict |
|---|---|---|
| `rshankras/claude-code-apple-skills` | 751 stars, 71 forks, 121 commits. 164 skills across iOS/macOS/watchOS/visionOS incl. Liquid Glass, animation, game feel, UX writing (PACE framework), SF Symbols, typography. Installs via standard `/plugin marketplace add` + `/plugin install`. | **Recommend this one** if/when Apple HIG guidance is needed — real community vetting, clean install path |
| `ebuntario/apple-hig` | 5 stars, 12 commits, MIT. Strong value prop (compliance-auditing: semantic colors/Dynamic Type/SF Symbols/44pt targets/VoiceOver/Reduce Motion, live HIG citations) but installs by `git clone` + running an unaudited `./setup` script directly into `~/.claude/skills/` | **Skip** — thin repo + "run a stranger's setup script" install pattern is an avoidable supply-chain risk when a better-vetted alternative exists |
| `NutshellEngineering/apple-design-skill` | 6 stars, 2 commits, Apache-2.0. Mirrors HIG content across all Apple platforms via a plugin marketplace. | **Skip for now** — too thin to trust as primary; `rshankras` covers the same ground with far more scrutiny behind it |

**Action for the user** (I cannot run this non-interactively): when Apple
HIG guidance is actually needed —
```
/plugin marketplace add rshankras/claude-code-apple-skills
/plugin install apple-skills@indie-apple-stack
```
— but skim the repo first regardless of star count; installing any plugin
means trusting its hooks/commands.

## 5. Forward-looking watchlist (not needed now — tagged to the phase that triggers each)

The pasted list of 19 items was itself curated by another AI and turned out
to be mostly redundant (§3). Re-scanning the full ~350-plugin official
catalog against the project's actual lifecycle (not just that list)
surfaces a few more candidates worth recording so they aren't
re-discovered from scratch later. **None of these change the current
phase gate — nothing installs now.** All are in the already-registered
official marketplace unless noted, so using one later is a one-command
install, not a new trust decision.

| Candidate | Maps to | Triggered by |
|---|---|---|
| `agent-sdk-dev` (official) | Product vision §46/50: the Life Master Agent orchestration layer itself | Phase 0-D (agent architecture) — *only* if the ADR chooses to build the orchestration on Anthropic's Agent SDK rather than a hand-rolled or other-framework orchestrator. `atomic-agents` and `pydantic-ai` are the equivalent for two other frameworks (Atomic Agents; Python+Pydantic) — irrelevant unless the ADR picks one of those specifically. Don't pre-decide the framework to justify installing a skill for it. |
| `langfuse` / `langfuse-observability` (official) | Product vision §45–46: every AI output traceable to model/prompt/agent version, tool calls, sources, timestamp | Once the agent architecture is actually implemented and needs real tracing, not at the doc-writing stage |
| `deepeval` (official) | Product vision §48: automated eval suites for accuracy, safety, hallucination, consistency, provenance | Same trigger as above — this maps unusually closely to §48's specific eval categories, worth a closer look first when that phase arrives |
| `revenuecat` (official, listed as both `rc` and `revenuecat`) | Product vision §21: StoreKit + **server-side entitlement model**, "never trust only the device" | The subscription-architecture decision inside the ADR — RevenueCat is a well-established way to get server-side entitlement sync right without hand-rolling receipt validation; worth naming as an option to evaluate, not a default choice |
| `sonatype-guide` (official) | Product vision §49: dependency/supply-chain scanning, distinct from the code-level `semgrep`/`sonarqube`/`claude-security` already noted in §2 | Pre-launch hardening pass, not now |
| `vanta` / `vanta-mcp-plugin` (official) | Product vision §22: ongoing legal/compliance posture (GDPR-adjacent, health-data governance) | Only relevant once there's a real compliance program to automate — this is a paid third-party SaaS behind the MCP, not a free skill, so it's a business decision as much as a technical one; flagging for awareness, not recommending |
| `figma` (official) | Brand/design master prompt — bridging Figma files/tokens into code | Once the design-system phase has actual Figma files to read |

**One open unknown, not resolved either way**: my verification of
`rshankras/claude-code-apple-skills` (§4) only confirmed 7 named *design*
skills (Liquid Glass, animation, game feel, UX writing, SF Symbols,
typography, UI prototyping) out of the 164 the repo claims. I have not
verified whether the remaining ~157 include *engineering* skills for
HealthKit, StoreKit, or EventKit (Calendar) — which the MVP (product
vision §52) actually needs and which no other installed capability
currently covers at all. Don't assume either way; check the repo's actual
skill list at install time, and if HealthKit/StoreKit/EventKit engineering
guidance turns out not to be in there, that's a second, separate gap to
solve for (most likely just Apple's own official documentation via
`documentation-lookup`/WebFetch, which needs no plugin).

## 6. Everything else observed (context, not action items)

- No global or project `CLAUDE.md` existed before this audit; no prior
  memory about plos existed in the persistent memory store.
- `/Users/yuvalharat/Claude/.claude/agents/` holds five subagents from an
  unrelated prior project (`faceless-shorts` / YouTube pipeline:
  `youtube-connector`, `script-writer`, `content-planner`, `video-
  researcher`, `quality-guard`) and `.claude/launch.json` (also unrelated).
  Left untouched — not plos's concern, and not evidence of anything
  missing for this project.
- A number of already-connected MCP servers are incidentally useful later
  but are not audited further here since they're not gating anything:
  Google Calendar MCP (useful once we build the calendar adapter),
  Figma MCP (useful once the design system phase starts), Gmail/Drive
  (not currently relevant to plos).

## 7. Bottom line

No third-party plugin installation is blocking or recommended right now.
The environment already has, without any install step, real equivalents
for every pasted recommendation except Apple HIG specifics, which is
correctly deferred to the design phase rather than installed speculatively.
The §5 watchlist adds a few more phase-triggered candidates surfaced by
scanning the full catalog against the project's lifecycle rather than the
originally pasted list — none of them change that. Proceed to Phase 0
(architecture) using what's already active.
