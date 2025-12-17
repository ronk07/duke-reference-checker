type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string, ...args: unknown[]) => void;
  groupCollapsed: (label: string, ...args: unknown[]) => void;
  groupEnd: () => void;
  time: (label: string) => void;
  timeEnd: (label: string) => void;
};

function ts(): string {
  // ISO without ms is noisy; keep ms for tracing
  return new Date().toISOString();
}

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return order[level] >= order[minLevel];
}

export function createLogger(scope: string, minLevel: LogLevel = 'info'): Logger {
  const prefix = `[${ts()}] [${scope}]`;

  const mk = (level: LogLevel) => (...args: unknown[]) => {
    if (!shouldLog(level, minLevel)) return;
    const fn = level === 'debug' ? console.debug : level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
    fn(prefix, ...args);
  };

  return {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    group: (label: string, ...args: unknown[]) => {
      if (!shouldLog('info', minLevel)) return;
      console.group(`${prefix} ${label}`, ...args);
    },
    groupCollapsed: (label: string, ...args: unknown[]) => {
      if (!shouldLog('info', minLevel)) return;
      console.groupCollapsed(`${prefix} ${label}`, ...args);
    },
    groupEnd: () => {
      if (!shouldLog('info', minLevel)) return;
      console.groupEnd();
    },
    time: (label: string) => {
      if (!shouldLog('info', minLevel)) return;
      console.time(`${prefix} ${label}`);
    },
    timeEnd: (label: string) => {
      if (!shouldLog('info', minLevel)) return;
      console.timeEnd(`${prefix} ${label}`);
    },
  };
}

