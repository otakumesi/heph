export type HephJob =
  | { type: "schedule_agent"; agentId: string }
  | { type: "execute_run"; agentId: string; runId: string }
  | { type: "resume_run"; agentId: string; runId: string }
  | { type: "cancel_run"; agentId: string; runId: string }
  | { type: "ingest_memory"; agentId: string; runId?: string };

export interface EnqueueOptions {
  delayMs?: number;
  idempotencyKey?: string;
}

export interface QueueAdapter {
  enqueue(job: HephJob, options?: EnqueueOptions): Promise<void>;
  startConsumer?(handler: (job: HephJob) => Promise<void>): Promise<void>;
  handleBatch?(rawEvent: unknown, handler: (job: HephJob) => Promise<void>): Promise<void>;
  onIdle?(): Promise<void>;
}

export interface InProcessQueueOptions {
  concurrency?: number;
  onError?: (error: unknown, job: HephJob) => void;
}

export class InProcessQueue implements QueueAdapter {
  private readonly concurrency: number;
  private readonly onError: (error: unknown, job: HephJob) => void;
  private readonly jobs: HephJob[] = [];
  private readonly activeAgents = new Set<string>();
  private readonly idleResolvers = new Set<() => void>();
  private activeCount = 0;
  private scheduled = false;
  private handler: ((job: HephJob) => Promise<void>) | null = null;

  constructor(options: InProcessQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 4;
    this.onError =
      options.onError ??
      ((error, job) => {
        console.error("Unhandled Heph in-process queue error", { error, job });
      });
  }

  async startConsumer(handler: (job: HephJob) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.schedule();
  }

  async enqueue(job: HephJob): Promise<void> {
    this.jobs.push(job);
    this.schedule();
  }

  async onIdle(): Promise<void> {
    if (this.isIdle()) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  private schedule(): void {
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (!this.handler) {
      this.resolveIdleIfNeeded();
      return;
    }

    while (this.activeCount < this.concurrency) {
      const index = this.jobs.findIndex((job) => !this.activeAgents.has(job.agentId));

      if (index === -1) {
        break;
      }

      const [job] = this.jobs.splice(index, 1);

      if (!job) {
        break;
      }

      this.activeCount += 1;
      this.activeAgents.add(job.agentId);

      void this.handler(job)
        .catch((error) => {
          this.onError(error, job);
        })
        .finally(() => {
          this.activeCount -= 1;
          this.activeAgents.delete(job.agentId);
          this.resolveIdleIfNeeded();
          this.schedule();
        });
    }

    this.resolveIdleIfNeeded();
  }

  private isIdle(): boolean {
    return this.jobs.length === 0 && this.activeCount === 0;
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) {
      return;
    }

    for (const resolve of this.idleResolvers) {
      resolve();
    }

    this.idleResolvers.clear();
  }
}
