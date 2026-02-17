import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

// ── Discriminated Union for Tree Nodes ──────────────────────

interface DictionaryNode {
  kind: 'dictionary';
  sessionId: number;
  dictIndex: number;   // 1-based index in SymbolList
  name: string;
}

interface ClassCategoryNode {
  kind: 'classCategory';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  name: string;           // category name, or '** ALL **'
}

interface ClassNode {
  kind: 'class';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  name: string;
}

interface SideNode {
  kind: 'side';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  environmentId: number;
}

interface CategoryNode {
  kind: 'category';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  environmentId: number;
  name: string;
}

interface DefinitionNode {
  kind: 'definition';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
}

interface CommentNode {
  kind: 'comment';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
}

interface MethodNode {
  kind: 'method';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  environmentId: number;
  category: string;
  selector: string;
}

interface GlobalNode {
  kind: 'global';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  name: string;
}

export type BrowserNode =
  | DictionaryNode
  | ClassCategoryNode
  | ClassNode
  | DefinitionNode
  | CommentNode
  | SideNode
  | CategoryNode
  | MethodNode
  | GlobalNode;

// ── Helpers ─────────────────────────────────────────────────

function getMaxEnvironment(): number {
  return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
}

// ── TreeItem mapping ────────────────────────────────────────

function toTreeItem(node: BrowserNode): vscode.TreeItem {
  switch (node.kind) {
    case 'dictionary': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      item.contextValue = 'gemstoneDictionary';
      return item;
    }
    case 'classCategory': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-folder');
      item.contextValue = 'gemstoneClassCategory';
      return item;
    }
    case 'class': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-class');
      item.contextValue = 'gemstoneClass';
      return item;
    }
    case 'definition': {
      const item = new vscode.TreeItem('definition', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-structure');
      item.contextValue = 'gemstoneDefinition';
      const uri = vscode.Uri.parse(
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/definition`
      );
      item.command = {
        command: 'vscode.open',
        title: 'Open Class Definition',
        arguments: [uri],
      };
      item.tooltip = `${node.className} definition`;
      return item;
    }
    case 'comment': {
      const item = new vscode.TreeItem('comment', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('comment');
      item.contextValue = 'gemstoneComment';
      const uri = vscode.Uri.parse(
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/comment`
      );
      item.command = {
        command: 'vscode.open',
        title: 'Open Class Comment',
        arguments: [uri],
      };
      item.tooltip = `${node.className} comment`;
      return item;
    }
    case 'side': {
      const maxEnv = getMaxEnvironment();
      const base = node.isMeta ? 'class' : 'instance';
      const label = maxEnv > 0 ? `${base} ${node.environmentId}` : base;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(node.isMeta ? 'symbol-interface' : 'symbol-method');
      item.contextValue = 'gemstoneSide';
      return item;
    }
    case 'category': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-folder');
      item.contextValue = 'gemstoneCategory';
      return item;
    }
    case 'method': {
      const item = new vscode.TreeItem(node.selector, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-method');
      item.contextValue = 'gemstoneMethod';
      const side = node.isMeta ? 'class' : 'instance';
      let uriStr =
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/${side}` +
        `/${encodeURIComponent(node.category)}` +
        `/${encodeURIComponent(node.selector)}`;
      if (node.environmentId > 0) {
        uriStr += `?env=${node.environmentId}`;
      }
      const uri = vscode.Uri.parse(uriStr);
      item.command = {
        command: 'vscode.open',
        title: 'Open Method',
        arguments: [uri],
      };
      item.tooltip = `${node.className}${node.isMeta ? ' class' : ''}>>#${node.selector}`;
      return item;
    }
    case 'global': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-variable');
      item.contextValue = 'gemstoneGlobal';
      item.tooltip = `${node.dictName} → ${node.name}`;
      item.command = {
        command: 'gemstone.inspectGlobal',
        title: 'Inspect',
        arguments: [node],
      };
      return item;
    }
  }
}

// ── TreeDataProvider ────────────────────────────────────────

// Per-class cache of bulk environment data
// Key: `${isMeta?1:0}|${envId}|${categoryName}` → sorted selectors
interface EnvCacheEntry {
  categories: Map<string, string[]>;
}

// Per-dictionary cache of classes grouped by class category + non-class globals
// Key: `${sessionId}/${dictIndex}`
interface ClassCategoryCacheEntry {
  categories: Map<string, string[]>;  // classCategoryName → sorted class names
  globals: string[];                   // sorted non-class global names
}

export class BrowserTreeProvider implements vscode.TreeDataProvider<BrowserNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BrowserNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private envCache = new Map<string, EnvCacheEntry>();
  private classCategoryCache = new Map<string, ClassCategoryCacheEntry>();

  constructor(private sessionManager: SessionManager) {
    sessionManager.onDidChangeSelection(() => this.refresh());
  }

  refresh(): void {
    this.envCache.clear();
    this.classCategoryCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BrowserNode): vscode.TreeItem {
    return toTreeItem(element);
  }

  async getChildren(element?: BrowserNode): Promise<BrowserNode[]> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    try {
      if (!element) {
        return this.getDictionaries(session);
      }
      switch (element.kind) {
        case 'dictionary':
          return this.getClassCategories(session, element);
        case 'classCategory':
          return this.getClassesInCategory(element);
        case 'class':
          return this.getSides(element);
        case 'side':
          return this.getCategories(session, element);
        case 'category':
          return this.getMethods(session, element);
        case 'definition':
        case 'comment':
        case 'method':
        case 'global':
          return [];
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Browser query failed: ${msg}`);
      return [];
    }
  }

  private getDictionaries(session: ActiveSession): BrowserNode[] {
    return queries.getDictionaryNames(session).map((name, i) => ({
      kind: 'dictionary' as const,
      sessionId: session.id,
      dictIndex: i + 1,  // Smalltalk SymbolList is 1-based
      name,
    }));
  }

  private getOrFetchClassCategoryCache(
    session: ActiveSession, dict: DictionaryNode,
  ): ClassCategoryCacheEntry {
    const cacheKey = `${dict.sessionId}/${dict.dictIndex}`;
    let entry = this.classCategoryCache.get(cacheKey);
    if (entry) return entry;

    const lines = queries.getDictionaryEntries(session, dict.dictIndex);
    entry = { categories: new Map(), globals: [] };
    for (const { isClass, category, name } of lines) {
      if (isClass) {
        const cat = category || '';
        let list = entry.categories.get(cat);
        if (!list) {
          list = [];
          entry.categories.set(cat, list);
        }
        list.push(name);
      } else {
        entry.globals.push(name);
      }
    }
    // Sort class names within each category, and globals
    for (const list of entry.categories.values()) {
      list.sort();
    }
    entry.globals.sort();
    this.classCategoryCache.set(cacheKey, entry);
    return entry;
  }

  private getClassCategories(session: ActiveSession, dict: DictionaryNode): BrowserNode[] {
    const entry = this.getOrFetchClassCategoryCache(session, dict);
    const nodes: BrowserNode[] = [{
      kind: 'classCategory' as const,
      sessionId: dict.sessionId,
      dictIndex: dict.dictIndex,
      dictName: dict.name,
      name: '** ALL **',
    }];

    const catNames = [...entry.categories.keys()].sort();
    for (const name of catNames) {
      nodes.push({
        kind: 'classCategory' as const,
        sessionId: dict.sessionId,
        dictIndex: dict.dictIndex,
        dictName: dict.name,
        name,
      });
    }

    if (entry.globals.length > 0) {
      nodes.push({
        kind: 'classCategory' as const,
        sessionId: dict.sessionId,
        dictIndex: dict.dictIndex,
        dictName: dict.name,
        name: '** OTHER GLOBALS **',
      });
    }

    return nodes;
  }

  private getClassesInCategory(catNode: ClassCategoryNode): BrowserNode[] {
    const cacheKey = `${catNode.sessionId}/${catNode.dictIndex}`;
    const entry = this.classCategoryCache.get(cacheKey);
    if (!entry) return [];

    if (catNode.name === '** OTHER GLOBALS **') {
      return entry.globals.map(name => ({
        kind: 'global' as const,
        sessionId: catNode.sessionId,
        dictIndex: catNode.dictIndex,
        dictName: catNode.dictName,
        name,
      }));
    }

    let classNames: string[];
    if (catNode.name === '** ALL **') {
      const all = new Set<string>();
      for (const list of entry.categories.values()) {
        for (const name of list) all.add(name);
      }
      classNames = [...all].sort();
    } else {
      classNames = entry.categories.get(catNode.name) ?? [];
    }

    return classNames.map(name => ({
      kind: 'class' as const,
      sessionId: catNode.sessionId,
      dictIndex: catNode.dictIndex,
      dictName: catNode.dictName,
      name,
    }));
  }

  private getSides(classNode: ClassNode): BrowserNode[] {
    const maxEnv = getMaxEnvironment();
    const nodes: BrowserNode[] = [
      {
        kind: 'definition' as const,
        sessionId: classNode.sessionId,
        dictIndex: classNode.dictIndex,
        dictName: classNode.dictName,
        className: classNode.name,
      },
      {
        kind: 'comment' as const,
        sessionId: classNode.sessionId,
        dictIndex: classNode.dictIndex,
        dictName: classNode.dictName,
        className: classNode.name,
      },
    ];

    if (maxEnv === 0) {
      nodes.push(
        {
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: false,
          environmentId: 0,
        },
        {
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: true,
          environmentId: 0,
        },
      );
    } else {
      for (let env = 0; env <= maxEnv; env++) {
        nodes.push({
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: false,
          environmentId: env,
        });
      }
      for (let env = 0; env <= maxEnv; env++) {
        nodes.push({
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: true,
          environmentId: env,
        });
      }
    }

    return nodes;
  }

  private getCategories(session: ActiveSession, side: SideNode): BrowserNode[] {
    const maxEnv = getMaxEnvironment();
    const allNode: BrowserNode = {
      kind: 'category' as const,
      sessionId: side.sessionId,
      dictIndex: side.dictIndex,
      dictName: side.dictName,
      className: side.className,
      isMeta: side.isMeta,
      environmentId: side.environmentId,
      name: '** ALL **',
    };

    const entry = this.getOrFetchEnvCache(session, side, maxEnv);
    const prefix = `${side.isMeta ? 1 : 0}|${side.environmentId}|`;
    const categories: string[] = [];
    for (const key of entry.categories.keys()) {
      if (key.startsWith(prefix)) {
        categories.push(key.substring(prefix.length));
      }
    }
    categories.sort();

    const cats = categories.map(name => ({
      kind: 'category' as const,
      sessionId: side.sessionId,
      dictIndex: side.dictIndex,
      dictName: side.dictName,
      className: side.className,
      isMeta: side.isMeta,
      environmentId: side.environmentId,
      name,
    }));
    return [allNode, ...cats];
  }

  private getMethods(session: ActiveSession, cat: CategoryNode): BrowserNode[] {
    const maxEnv = getMaxEnvironment();
    const entry = this.getOrFetchEnvCache(session, cat, maxEnv);

    if (cat.name === '** ALL **') {
      return this.getAllMethodsFromCache(cat, entry);
    }

    const key = `${cat.isMeta ? 1 : 0}|${cat.environmentId}|${cat.name}`;
    const selectors = entry.categories.get(key) ?? [];

    return selectors.map(selector => ({
      kind: 'method' as const,
      sessionId: cat.sessionId,
      dictIndex: cat.dictIndex,
      dictName: cat.dictName,
      className: cat.className,
      isMeta: cat.isMeta,
      environmentId: cat.environmentId,
      category: cat.name,
      selector,
    }));
  }

  private getAllMethodsFromCache(cat: CategoryNode, entry: EnvCacheEntry): BrowserNode[] {
    const prefix = `${cat.isMeta ? 1 : 0}|${cat.environmentId}|`;
    const methods: BrowserNode[] = [];

    for (const [key, selectors] of entry.categories) {
      if (!key.startsWith(prefix)) continue;
      const realCategory = key.substring(prefix.length);
      for (const selector of selectors) {
        methods.push({
          kind: 'method' as const,
          sessionId: cat.sessionId,
          dictIndex: cat.dictIndex,
          dictName: cat.dictName,
          className: cat.className,
          isMeta: cat.isMeta,
          environmentId: cat.environmentId,
          category: realCategory,
          selector,
        });
      }
    }

    methods.sort((a, b) => {
      if (a.kind !== 'method' || b.kind !== 'method') return 0;
      return a.selector.localeCompare(b.selector);
    });
    return methods;
  }

  private getOrFetchEnvCache(
    session: ActiveSession,
    node: { dictIndex: number; className: string; sessionId: number },
    maxEnv: number,
  ): EnvCacheEntry {
    const cacheKey = `${node.sessionId}/${node.dictIndex}/${node.className}`;
    let entry = this.envCache.get(cacheKey);
    if (entry) return entry;

    const lines = queries.getClassEnvironments(session, node.dictIndex, node.className, maxEnv);
    entry = { categories: new Map() };
    for (const line of lines) {
      const key = `${line.isMeta ? 1 : 0}|${line.envId}|${line.category}`;
      entry.categories.set(key, line.selectors);
    }
    this.envCache.set(cacheKey, entry);
    return entry;
  }
}
