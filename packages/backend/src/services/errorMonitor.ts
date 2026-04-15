interface ErrorEvent {
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  level: 'error' | 'warning' | 'info';
  timestamp: string;
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const event: ErrorEvent = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    context,
    level: 'error',
    timestamp: new Date().toISOString(),
  };
  console.error(JSON.stringify(event));
  if (process.env.SENTRY_DSN) {
    sendToSentry(event).catch(() => {});
  }
}

async function sendToSentry(event: ErrorEvent): Promise<void> {
  const dsn = process.env.SENTRY_DSN!;
  const match = dsn.match(/https:\/\/([^@]+)@([^/]+)\/(.+)/);
  if (!match) return;
  const [, pubKey, host, projectId] = match;

  await fetch(`https://${host}/api/${projectId}/store/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${pubKey}`,
    },
    body: JSON.stringify({
      event_id: crypto.randomUUID(),
      timestamp: event.timestamp,
      level: event.level,
      message: event.message,
      extra: { context: event.context },
      exception: event.stack
        ? { values: [{ type: 'Error', value: event.message, stacktrace: { frames: event.stack.split('\n').map(l => ({ filename: l })) } }] }
        : undefined,
    }),
  });
}

export function captureWarning(message: string, context?: Record<string, unknown>): void {
  console.warn(JSON.stringify({ message, context, level: 'warning', timestamp: new Date().toISOString() }));
}
