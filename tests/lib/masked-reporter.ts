import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import { masked } from './operator-name';

// A run's report is printed, in the public log of each run in CI too, and Playwright's own words in it quote the page:
// a locator it suggests, the element it found, the value it received. This reporter is Playwright's own, list or
// github, as given, with all it is told masked first, so his name is in none of it: each error's message, stack and
// snippet, each step's title, each test's title, output and attachments, and the page snapshot Playwright writes
// beside a failure. With github, Playwright's dots go to the log too, as they do without this reporter, masked the
// same.
type Hooks = Partial<Record<string, (...args: unknown[]) => unknown>>;
type Options = { reporter?: string; configDir?: string; _mode?: string } & Record<string, unknown>;
const { runnerReporters } = createRequire(import.meta.url)('playwright/lib/runner') as {
  runnerReporters: {
    createReporters(config: unknown, mode: string, descriptions: [string, unknown][]): Promise<Hooks[]>;
  };
};

// Text masked as it is printed, its colours left out of the reading and kept where they were: masking keeps the
// length of the text, so each piece between two colours is cut from the masked text in its place.
const COLOUR = /(\x1b\[[0-?]*[ -/]*[@-~])/;
export function shown(text: string): string {
  const pieces = text.split(COLOUR);
  const plain = pieces.filter((_, at) => at % 2 === 0).join('');
  const hidden = masked(plain);
  if (hidden === plain) return text;
  let from = 0;
  return pieces.map((piece, at) => (at % 2 ? piece : hidden.slice(from, (from += piece.length)))).join('');
}
const shownChunk = (chunk: unknown) => {
  if (typeof chunk === 'string') return shown(chunk);
  const text = (chunk as Buffer).toString('utf8');
  return shown(text) === text ? chunk : Buffer.from(shown(text));
};
// Each is masked where it is, so the summary at the end of the run, which reads the results again, is masked too.
function maskError(error: TestError & { errorContext?: string }) {
  for (const key of ['message', 'stack', 'snippet', 'value', 'errorContext'] as const)
    if (typeof error[key] === 'string') error[key] = shown(error[key]);
  if (error.cause) maskError(error.cause);
}
function maskStep(step: TestStep) {
  step.title = shown(step.title);
  if (step.error) maskError(step.error);
  for (const annotation of step.annotations ?? [])
    if (annotation.description) annotation.description = shown(annotation.description);
  step.steps.forEach(maskStep);
}
function maskResult(test: TestCase, result: TestResult) {
  result.errors.forEach(maskError);
  if (result.error) maskError(result.error);
  result.stdout = result.stdout.map((chunk) => shownChunk(chunk) as string | Buffer);
  result.stderr = result.stderr.map((chunk) => shownChunk(chunk) as string | Buffer);
  result.steps.forEach(maskStep);
  for (const annotation of [...test.annotations, ...(result.annotations ?? [])])
    if (annotation.description) annotation.description = shown(annotation.description);
  for (const attachment of result.attachments) {
    attachment.name = shown(attachment.name);
    if (attachment.body && /^text\/|json|xml/.test(attachment.contentType))
      attachment.body = Buffer.from(shown(attachment.body.toString('utf8')));
    // The page snapshot and the error, as written beside a failure for whoever reads its folder.
    if (attachment.path && /\.(?:md|txt|json|ya?ml)$/.test(attachment.path)) {
      const text = readFileSync(attachment.path, 'utf8');
      if (shown(text) !== text) writeFileSync(attachment.path, shown(text));
    }
    // Its path, printed in the report, holds the test's title, so it is shown masked once the file is written.
    if (attachment.path) attachment.path = shown(attachment.path);
  }
}
function maskTitles(suite: Suite) {
  suite.title = shown(suite.title);
  for (const test of suite.tests) test.title = shown(test.title);
  suite.suites.forEach(maskTitles);
}

export default class MaskedReporter {
  private reporters: Hooks[] | undefined;
  private waiting: [string, unknown[]][] = [];
  private made: Promise<void>;
  constructor({ reporter = 'list', ...options }: Options = {}) {
    // Made as Playwright makes a reporter named in the config, with the options it gives this one.
    const config = { configDir: options.configDir, config: { tags: [] } };
    this.made = runnerReporters.createReporters(config, options._mode ?? 'test', [[reporter, options]]).then((made) => {
      this.reporters = made;
      for (const [hook, args] of this.waiting.splice(0)) this.call(hook, args);
    });
  }
  private call(hook: string, args: unknown[]): unknown[] {
    if (!this.reporters) {
      this.waiting.push([hook, args]);
      return [];
    }
    return this.reporters.map((reporter) => reporter[hook]?.apply(reporter, args));
  }
  private async callAsync(hook: string, args: unknown[]) {
    await this.made;
    let out: unknown;
    for (const reporter of this.reporters!) out = (await reporter[hook]?.apply(reporter, args)) ?? out;
    return out;
  }
  version() {
    return 'v2';
  }
  printsToStdio() {
    return true;
  }
  onConfigure(config: FullConfig) {
    this.call('onConfigure', [config]);
  }
  onBegin(suite: Suite) {
    maskTitles(suite);
    this.call('onBegin', [suite]);
  }
  onTestBegin(test: TestCase, result: TestResult) {
    this.call('onTestBegin', [test, result]);
  }
  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    this.call('onStdOut', [shownChunk(chunk), test, result]);
  }
  onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    this.call('onStdErr', [shownChunk(chunk), test, result]);
  }
  onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    step.title = shown(step.title);
    this.call('onStepBegin', [test, result, step]);
  }
  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    maskStep(step);
    this.call('onStepEnd', [test, result, step]);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    maskResult(test, result);
    this.call('onTestEnd', [test, result]);
  }
  onError(error: TestError, ...rest: unknown[]) {
    maskError(error);
    this.call('onError', [error, ...rest]);
  }
  async onTestPaused(test: TestCase, result: TestResult) {
    maskResult(test, result);
    await this.callAsync('onTestPaused', [test, result]);
  }
  async onEnd(result: FullResult) {
    return (await this.callAsync('onEnd', [result])) as { status?: FullResult['status'] } | undefined;
  }
  async onExit() {
    await this.callAsync('onExit', []);
  }
}
