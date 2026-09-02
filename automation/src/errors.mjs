export class RunnerError extends Error {
  constructor(message, { code = "RUNNER_ERROR", cause, retryable = false } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = retryable;
  }
}

export class ConfigError extends RunnerError {
  constructor(message, options = {}) {
    super(message, { code: "CONFIG_ERROR", ...options });
  }
}

export class CommandError extends RunnerError {
  constructor(message, options = {}) {
    super(message, { code: "COMMAND_FAILED", ...options });
    this.exitCode = options.exitCode ?? null;
    this.stderr = options.stderr ?? "";
    this.stdout = options.stdout ?? "";
    this.timedOut = options.timedOut ?? false;
  }
}

export class LeaseLostError extends RunnerError {
  constructor(message = "Ticket lease was lost", options = {}) {
    super(message, { code: "LEASE_LOST", retryable: true, ...options });
  }
}

export class RemoteMovedError extends RunnerError {
  constructor(message = "origin/main moved after the ticket worktree was created", options = {}) {
    super(message, { code: "REMOTE_MAIN_MOVED", retryable: true, ...options });
  }
}

export class PolicyError extends RunnerError {
  constructor(message, options = {}) {
    super(message, { code: "POLICY_REJECTED", ...options });
  }
}
