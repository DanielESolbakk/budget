export class LedgerOperationCoordinator {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}