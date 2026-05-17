import type { HephJob, HephRuntime } from "@heph/core";

export interface CreateHephWorkerOptions {
  heph: HephRuntime;
}

export interface HephWorker {
  handle(job: HephJob): Promise<void>;
  start(): Promise<void>;
}

export function createHephWorker(options: CreateHephWorkerOptions): HephWorker {
  return {
    handle(job) {
      return options.heph.handleJob(job);
    },
    start() {
      return options.heph.startWorker();
    }
  };
}

export function handleHephJob(heph: HephRuntime, job: HephJob): Promise<void> {
  return heph.handleJob(job);
}
