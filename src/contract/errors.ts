export type CompatibilityProblem = {
  code: "unsupported-version" | "unknown-required-extension"
  message: string
  extension?: string
  version?: string
}

export type ValidationProblem = {
  code: string
  message: string
  path?: string
}

export class EikonCompatibilityError extends Error {
  problems: CompatibilityProblem[]

  constructor(problems: CompatibilityProblem[]) {
    super(problems.map(problem => problem.message).join("\n"))
    this.name = "EikonCompatibilityError"
    this.problems = problems
  }
}

export class EikonValidationError extends Error {
  problems: ValidationProblem[]

  constructor(problems: ValidationProblem[]) {
    super(problems.map(problem => problem.message).join("\n"))
    this.name = "EikonValidationError"
    this.problems = problems
  }
}
