# runtime/

Core agent runtime: the collector, check scheduler, process lifecycle,
configuration loading, and the agent's main control loop.

Common issues that belong here: agent crashes or restarts, high CPU/memory at
runtime, checks not running, config not being picked up, startup/shutdown bugs.

Owned by `@DataDog/agent-runtimes`.
