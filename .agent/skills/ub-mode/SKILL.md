---
name: ub-mode
description: "Use when writing or refactoring code under Robert C. Martin reduced principles (/ub-mode or /sdlc ub). Not for read-only status checks or non-code administrative tasks."
tools: read_file, write_file, edit_file, run_command
---

# ub-mode

Every time you are asked to make a change follow:
* First Make it Work.
* Then Make it Right.
* Follow Practice.

## Lane behavior
| Lane | How `ub-mode` applies |
| :--- | :--- |
| `trivial` | Ship the smallest edit that solves the problem; run affected tests if any exist. |
| `standard` | Model data shape first, Red-Green TDD, eliminate duplication, verify diff coverage (`sdlc-tdd`). |
| `full` | Full domain boundary discipline, idempotent operations, CRAP < 10, DRY, and mutation survival cleanup (`sdlc-tdd`). |

# First Make it Work

## Laziness Protocol
* One decision lives in one place.
* Ship the smallest edit that solves the problem.

## Foundational Thinking
* Get the data shape right before you write the logic.
* Do first whatever helps every later phase.
* If a concurrent writer would matter, do not share state.

## TDD
* Write the failing test before you change the code.
* See it fail for the reason you expect.
* Make the smallest change that makes it pass.
* If an honest test is impractical, do not write a bad one.

## Redesign From First Principles
* Do not bolt a new requirement onto the old design.
* Ask what you would have built if it had been there from the start, think that through, and deliver it in pieces.

## Attack the Premise
* When two fixes that share one premise fail the same gate, write that premise in one sentence and count which actors hold the imbalance.
* Remove the assignment.
* Do not start another fix until you have done that.

## Subtract Before You Add
* Take complexity out before you add anything.

## Outcome-Oriented Execution
* Aim at the end state you can check.
* A break in the middle is allowed when you planned it and can undo it.

## Build the Lever
* If the work is not obvious at a glance, build the tool that does it.
* Do one unit by hand, then make the tool match that unit.

## Architecture

### Model the Domain
* Put the domain in a structure that makes the illegal states impossible.
* Maintain a glossary of domain terms.
* If the code is already clear and local, leave it.

### Boundary Discipline
* Check the data where it enters.
* Inside, trust it.
* Keep the business logic in a pure function.

### Type System Discipline
* Make the illegal value impossible to write.
* Parse outside data once, where it comes in.
* Do not silence the compiler.

### Make Operations Idempotent
* Running it twice, or running it after a crash halfway through, ends in the same state.

### Separate Before Serializing Shared State
* If they do not need the same mutable thing, give each its own.
* If they do, allow one writer, and enforce that in the structure.

# Then Make it Right

## Fix Root Causes
* Reproduce it.
* Fix the cause.
* A guard that only hides the crash is not a fix.

## Sequence Work into Verifiable Units
* Finish one small unit and check it.
* Then start the next.

## Test Behavior, Not Implementation
* The test calls the code the way its user does and checks the result that user would see.
* If the test would still pass when every function returned nothing, throw it out.

## Crapper / Complexity
* Reduce each function under CRAP 10 by splitting it, by testing it, or both.
* Consider whether case statements are worth reducing.

## Dryer / Duplication
* Eliminate duplication that ranks 0.8 or above.

## Mutator
* Cover the uncovered, kill surviving mutants, and delete dead code (`node .agent/scripts/sdlc-engine.mjs mutation` in `full` lane).

## Refactoring
* Pin what the code does, change the structure, and prove the behavior did not change.

# Practice

* **Keep a Log**: Track actions taken and why; report concisely upon completion.
* **Guard the Context Window**: Keep the main thread small; delegate bulk read-only exploration and keep summaries.
* **Worktree Cleanup**: Reclaim safe-to-remove temporary artifacts; never discard uncommitted user work without asking.
* **Commit Often**: Make small, ordered commits once tests are green.

## Done when
The smallest clean change passes behavioral tests without duplication or boundary leaks, verified at the active lane's quality bar.
