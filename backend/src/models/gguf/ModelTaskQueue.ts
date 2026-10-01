/** Serializes native model operations while allowing different models to run. */
export class ModelTaskQueue {
  private tasks = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tasks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    const settled = current.catch(() => {});
    this.tasks.set(key, settled);
    void settled.then(() => { if (this.tasks.get(key) === settled) this.tasks.delete(key); });
    return current;
  }

  async wait(key: string): Promise<void> { await this.tasks.get(key); }
}
