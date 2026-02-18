import { vi } from 'vitest';

// ── Configuration mock ─────────────────────────────────────

const configStore: Record<string, Record<string, unknown>> = {};

function getConfiguration(section: string) {
  if (!configStore[section]) {
    configStore[section] = {};
  }
  return {
    get<T>(key: string, defaultValue?: T): T {
      const val = configStore[section][key];
      return (val !== undefined ? val : defaultValue) as T;
    },
    update: vi.fn(async (key: string, value: unknown, _target?: number) => {
      configStore[section][key] = value;
    }),
  };
}

/** Reset all stored config values between tests. */
export function __resetConfig(): void {
  for (const key of Object.keys(configStore)) {
    delete configStore[key];
  }
}

/** Pre-seed a config section for testing. */
export function __setConfig(section: string, key: string, value: unknown): void {
  if (!configStore[section]) {
    configStore[section] = {};
  }
  configStore[section][key] = value;
}

// ── TreeItem mock ──────────────────────────────────────────

export class TreeItem {
  label?: string;
  id?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  collapsibleState?: number;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

// ── ThemeIcon mock ─────────────────────────────────────────

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

// ── EventEmitter mock ──────────────────────────────────────

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ── ConfigurationTarget mock ───────────────────────────────

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

// ── ViewColumn mock ────────────────────────────────────────

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
};

// ── Window mock ────────────────────────────────────────────

function createMockWebview() {
  return {
    html: '',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
  };
}

function createMockPanel() {
  const webview = createMockWebview();
  return {
    webview,
    title: '',
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
  };
}

export const window = {
  activeTextEditor: undefined as unknown,
  createWebviewPanel: vi.fn((_viewType: string, title: string) => {
    const panel = createMockPanel();
    panel.title = title;
    return panel;
  }),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createTreeView: vi.fn(() => ({ dispose: () => {} })),
  createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })),
};

// ── Workspace mock ─────────────────────────────────────────

export const workspace = {
  getConfiguration,
  onDidChangeConfiguration: vi.fn(() => ({ dispose: () => {} })),
};

// ── Commands mock ──────────────────────────────────────────

export const commands = {
  registerCommand: vi.fn((_command: string, _callback: unknown) => ({ dispose: () => {} })),
};

// ── Uri mock ───────────────────────────────────────────────

export class Uri {
  scheme: string;
  authority: string;
  path: string;
  fsPath: string;
  query: string;
  fragment: string;

  private constructor(scheme: string, authority: string, path: string, query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.fsPath = path;
    this.query = query;
    this.fragment = fragment;
  }

  with(_change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      _change.scheme ?? this.scheme,
      _change.authority ?? this.authority,
      _change.path ?? this.path,
      _change.query ?? this.query,
      _change.fragment ?? this.fragment,
    );
  }

  toJSON(): unknown {
    return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment };
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }

  static file(path: string) {
    return new Uri('file', '', path);
  }

  static parse(value: string): Uri {
    const match = value.match(/^([^:]+):\/\/([^/]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/);
    if (match) {
      return new Uri(match[1], match[2], match[3], match[4] || '', match[5] || '');
    }
    return new Uri('file', '', value);
  }
}

// ── FileSystemError mock ──────────────────────────────────

export class FileSystemError extends Error {
  code: string;
  constructor(message: string, code = 'Unknown') {
    super(message);
    this.code = code;
  }
  static FileNotFound(uri?: unknown): FileSystemError {
    return new FileSystemError(`File not found: ${uri}`, 'FileNotFound');
  }
  static NoPermissions(uri?: unknown): FileSystemError {
    return new FileSystemError(`No permissions: ${uri}`, 'NoPermissions');
  }
  static Unavailable(message?: string): FileSystemError {
    return new FileSystemError(message || 'Unavailable', 'Unavailable');
  }
}

// ── FileType mock ─────────────────────────────────────────

export const FileType = {
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

// ── FileChangeType mock ───────────────────────────────────

export const FileChangeType = {
  Changed: 1,
  Created: 2,
  Deleted: 3,
};

// ── Position & Location mock ──────────────────────────────

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position,
  ) {}
}

export class Location {
  constructor(public readonly uri: Uri, public readonly range: Position | Range) {}
}

// ── SymbolInformation mock ───────────────────────────────

export const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
};

export class SymbolInformation {
  constructor(
    public readonly name: string,
    public readonly kind: number,
    public readonly containerName: string,
    public readonly location: Location,
  ) {}
}

// ── Languages mock ───────────────────────────────────────

export const languages = {
  registerWorkspaceSymbolProvider: vi.fn(() => ({ dispose: () => {} })),
  registerDefinitionProvider: vi.fn(() => ({ dispose: () => {} })),
  registerHoverProvider: vi.fn(() => ({ dispose: () => {} })),
  registerCompletionItemProvider: vi.fn(() => ({ dispose: () => {} })),
  setTextDocumentLanguage: vi.fn(),
};

// ── MarkdownString mock ──────────────────────────────────

export class MarkdownString {
  constructor(public value: string = '') {}
  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }
  appendCodeblock(code: string, language?: string): MarkdownString {
    this.value += '\n```' + (language || '') + '\n' + code + '\n```\n';
    return this;
  }
}

// ── Hover mock ───────────────────────────────────────────

export class Hover {
  constructor(
    public contents: MarkdownString | MarkdownString[],
    public range?: Range,
  ) {}
}

// ── CompletionItem mock ──────────────────────────────────

export class CompletionItem {
  detail?: string;
  documentation?: string;
  sortText?: string;
  constructor(public label: string, public kind?: number) {}
}

export const CompletionItemKind = {
  Method: 1,
  Field: 4,
  Variable: 5,
  Class: 6,
  Keyword: 13,
  Constant: 20,
};

// ── Disposable mock ───────────────────────────────────────

export class Disposable {
  constructor(private callOnDispose: () => void) {}
  dispose(): void {
    this.callOnDispose();
  }
}
