import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL } from './gciConstants';
import { logQuery, logResult, logError, logGciCall, logGciResult } from './gciLog';

const MAX_RESULT = 256 * 1024;

// Cache resolved OOP_CLASS_Utf8 per session handle (Node.js strings are UTF-8 when passed via koffi)
const classUtf8Cache = new Map<unknown, bigint>();

export class BrowserQueryError extends Error {
  constructor(message: string, public readonly gciErrorNumber: number = 0) {
    super(message);
  }
}

function resolveClassUtf8(session: ActiveSession): bigint {
  let oop = classUtf8Cache.get(session.handle);
  if (oop !== undefined) return oop;
  const { result, err } = session.gci.GciTsResolveSymbol(session.handle, 'Utf8', OOP_NIL);
  if (err.number !== 0) {
    throw new BrowserQueryError(
      err.message || `Cannot resolve Utf8 class`, err.number
    );
  }
  oop = result;
  classUtf8Cache.set(session.handle, oop);
  return oop;
}

function executeFetchString(session: ActiveSession, label: string, code: string): string {
  logQuery(session.id, label, code);

  // Check if session is busy with an async operation (e.g., Display It)
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  logGciCall(session.id, 'GciTsExecuteFetchBytes', {
    sourceStr: code,
    sourceSize: -1,
    sourceOop: oopClassUtf8,
    contextObject: OOP_ILLEGAL,
    symbolList: OOP_NIL,
    maxResultSize: MAX_RESULT,
  });

  const { bytesReturned, data, err } = session.gci.GciTsExecuteFetchBytes(
    session.handle,
    code,
    -1,
    oopClassUtf8,
    OOP_ILLEGAL,
    OOP_NIL,
    MAX_RESULT,
  );

  logGciResult(session.id, 'GciTsExecuteFetchBytes', {
    bytesReturned,
    data,
    'err.number': err.number,
    'err.category': err.category,
    'err.context': err.context,
    'err.exceptionObj': err.exceptionObj,
    'err.args': err.args,
    'err.message': err.message,
    'err.reason': err.reason,
    'err.fatal': err.fatal,
  });

  if (err.number !== 0) {
    const msg = err.message || `GCI error ${err.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, err.number);
  }
  logResult(session.id, data);
  return data;
}

function splitLines(result: string): string[] {
  return result.split('\n').filter(s => s.length > 0);
}

function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

function receiver(className: string, isMeta: boolean): string {
  return isMeta ? `${className} class` : className;
}

export function getDictionaryNames(session: ActiveSession): string[] {
  const code = `| ws |
ws := WriteStream on: String new.
System myUserProfile symbolList names do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(executeFetchString(session, 'getDictionaryNames', code));
}

export function getClassNames(session: ActiveSession, dictName: string): string[] {
  const code = `| ws dict |
dict := System myUserProfile symbolList objectNamed: #'${escapeString(dictName)}'.
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [ws nextPutAll: k; lf]].
ws contents`;
  return splitLines(executeFetchString(session, `getClassNames(${dictName})`, code)).sort();
}

export interface DictEntry {
  isClass: boolean;
  category: string;   // class category for classes, '' for globals
  name: string;
}

export function getDictionaryEntries(
  session: ActiveSession, dictIndex: number,
): DictEntry[] {
  const code = `| ws dict |
dict := System myUserProfile symbolList at: ${dictIndex}.
ws := WriteStream on: Unicode7 new.
dict keysAndValuesDo: [:k :v |
  v isBehavior
    ifTrue: [ws nextPutAll: '1'; tab; nextPutAll: (v category ifNil: ['']); tab; nextPutAll: k; lf]
    ifFalse: [ws nextPutAll: '0'; tab; tab; nextPutAll: k asString; lf]].
ws contents`;

  const raw = executeFetchString(
    session, `getDictionaryEntries(dictIndex: ${dictIndex})`, code,
  );

  const results: DictEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const isClass = parts[0] === '1';
    const category = parts[1];
    const name = parts[2];
    if (name.length > 0) {
      results.push({ isClass, category, name });
    }
  }
  return results;
}

export function getMethodCategories(
  session: ActiveSession, className: string, isMeta: boolean
): string[] {
  const recv = receiver(className, isMeta);
  const code = `| ws |
ws := WriteStream on: String new.
${recv} categoryNames asSortedCollection do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(executeFetchString(session, `getMethodCategories(${recv})`, code));
}

export function getMethodSelectors(
  session: ActiveSession, className: string, isMeta: boolean, category: string
): string[] {
  const recv = receiver(className, isMeta);
  const code = `| ws |
ws := WriteStream on: String new.
(${recv} sortedSelectorsIn: '${escapeString(category)}')
  do: [:each |
    ws nextPutAll: each; lf].
ws contents`;
  return splitLines(executeFetchString(session, `getMethodSelectors(${recv}, '${category}')`, code));
}

export interface EnvCategoryLine {
  isMeta: boolean;
  envId: number;
  category: string;
  selectors: string[];
}

export function getClassEnvironments(
  session: ActiveSession, dictIndex: number, className: string, maxEnv: number,
): EnvCategoryLine[] {
  const code = `| class envs stream |
envs := ${maxEnv}.
class := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
stream := WriteStream on: Unicode7 new.
{ class class. class. } do: [:eachClass |
  0 to: envs do: [:env |
    (eachClass _unifiedCategorys: env) keysAndValuesDo: [:categoryName :selectors |
      stream
        nextPutAll: eachClass name; tab;
        nextPutAll: env printString; tab;
        nextPutAll: categoryName; tab;
        yourself.
      selectors do: [:each |
        stream nextPutAll: each; tab.
      ].
      stream lf.
    ].
  ].
].
stream contents`;

  const raw = executeFetchString(
    session, `getClassEnvironments(${className}, ${maxEnv})`, code,
  );

  const results: EnvCategoryLine[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t').filter(s => s.length > 0);
    if (parts.length < 3) continue;
    const receiverName = parts[0];
    const envId = parseInt(parts[1], 10);
    const category = parts[2];
    const selectors = parts.slice(3).sort();
    const isMeta = receiverName.endsWith(' class');
    results.push({ isMeta, envId, category, selectors });
  }
  return results;
}

export function getMethodSource(
  session: ActiveSession, className: string, isMeta: boolean, selector: string,
  environmentId: number = 0,
): string {
  const recv = receiver(className, isMeta);
  if (environmentId === 0) {
    const code = `(${recv} compiledMethodAt: #'${escapeString(selector)}') sourceString`;
    return executeFetchString(session, `getMethodSource(${recv}>>#${selector})`, code);
  }
  const code = `(${recv} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId}) sourceString`;
  return executeFetchString(
    session, `getMethodSource(${recv}>>#${selector} env:${environmentId})`, code,
  );
}

export function getClassDefinition(
  session: ActiveSession, className: string
): string {
  const code = `${className} definition`;
  return executeFetchString(session, `getClassDefinition(${className})`, code);
}

export function compileClassDefinition(
  session: ActiveSession, source: string
): void {
  // Wrap so the result is a String (the class name) — GciTsExecuteFetchBytes
  // requires a byte-object result, but class definitions return a Class.
  const code = `(${source}) name`;
  executeFetchString(session, 'compileClassDefinition', code);
}

export function getClassComment(
  session: ActiveSession, className: string
): string {
  const code = `${className} comment`;
  return executeFetchString(session, `getClassComment(${className})`, code);
}

export function setClassComment(
  session: ActiveSession, className: string, comment: string
): void {
  const code = `${className} comment: '${escapeString(comment)}'. 'ok'`;
  executeFetchString(session, `setClassComment(${className})`, code);
}

export function deleteMethod(
  session: ActiveSession, className: string, isMeta: boolean, selector: string
): void {
  const recv = receiver(className, isMeta);
  const code = `${recv} removeSelector: #'${escapeString(selector)}'. 'ok'`;
  executeFetchString(session, `deleteMethod(${recv}>>#${selector})`, code);
}

export function recategorizeMethod(
  session: ActiveSession, className: string, isMeta: boolean,
  selector: string, newCategory: string
): void {
  const recv = receiver(className, isMeta);
  const code = `${recv} moveMethod: #'${escapeString(selector)}' toCategory: '${escapeString(newCategory)}'. 'ok'`;
  executeFetchString(session, `recategorizeMethod(${recv}>>#${selector} → '${newCategory}')`, code);
}

export function renameCategory(
  session: ActiveSession, className: string, isMeta: boolean,
  oldCategory: string, newCategory: string
): void {
  const recv = receiver(className, isMeta);
  const code = `${recv} renameCategory: '${escapeString(oldCategory)}' to: '${escapeString(newCategory)}'. 'ok'`;
  executeFetchString(session, `renameCategory(${recv}, '${oldCategory}' → '${newCategory}')`, code);
}

export function deleteClass(
  session: ActiveSession, dictName: string, className: string
): void {
  const code = `(System myUserProfile symbolList objectNamed: #'${escapeString(dictName)}')
  removeKey: #'${escapeString(className)}' ifAbsent: []. 'ok'`;
  executeFetchString(session, `deleteClass(${dictName}, ${className})`, code);
}

export function moveClass(
  session: ActiveSession, srcDictName: string, destDictName: string, className: string
): void {
  const code = `| cls srcDict destDict |
srcDict := System myUserProfile symbolList objectNamed: #'${escapeString(srcDictName)}'.
destDict := System myUserProfile symbolList objectNamed: #'${escapeString(destDictName)}'.
cls := srcDict removeKey: #'${escapeString(className)}'.
destDict at: #'${escapeString(className)}' put: cls.
'ok'`;
  executeFetchString(session, `moveClass(${className}: ${srcDictName} → ${destDictName})`, code);
}

export function addDictionary(
  session: ActiveSession, dictName: string
): void {
  const code = `| dict |
dict := SymbolDictionary new.
dict name: #'${escapeString(dictName)}'.
System myUserProfile symbolList add: dict.
dict name`;
  executeFetchString(session, `addDictionary(${dictName})`, code);
}

export function moveDictionaryUp(
  session: ActiveSession, dictName: string
): void {
  const code = `| sl idx temp |
sl := System myUserProfile symbolList.
idx := sl names indexOf: #'${escapeString(dictName)}'.
idx > 1 ifTrue: [
  temp := sl at: idx.
  sl at: idx put: (sl at: idx - 1).
  sl at: idx - 1 put: temp].
'ok'`;
  executeFetchString(session, `moveDictionaryUp(${dictName})`, code);
}

export function moveDictionaryDown(
  session: ActiveSession, dictName: string
): void {
  const code = `| sl idx temp |
sl := System myUserProfile symbolList.
idx := sl names indexOf: #'${escapeString(dictName)}'.
idx < sl size ifTrue: [
  temp := sl at: idx.
  sl at: idx put: (sl at: idx + 1).
  sl at: idx + 1 put: temp].
'ok'`;
  executeFetchString(session, `moveDictionaryDown(${dictName})`, code);
}

export interface ClassNameEntry {
  dictIndex: number;
  dictName: string;
  className: string;
}

export function getAllClassNames(session: ActiveSession): ClassNameEntry[] {
  const code = `| ws sl seen |
ws := WriteStream on: Unicode7 new.
sl := System myUserProfile symbolList.
seen := IdentitySet new.
1 to: sl size do: [:idx |
  | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(seen includes: v) not]) ifTrue: [
      seen add: v.
      ws nextPutAll: idx printString; tab; nextPutAll: dict name; tab; nextPutAll: k; lf]]].
ws contents`;

  const raw = executeFetchString(session, 'getAllClassNames', code);
  const results: ClassNameEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      dictIndex: parseInt(parts[0], 10),
      dictName: parts[1],
      className: parts[2],
    });
  }
  return results;
}

export interface MethodSearchResult {
  dictName: string;
  className: string;
  isMeta: boolean;
  selector: string;
  category: string;
}

// Shared Smalltalk snippet: build classDict mapping classes to their first dictionary name,
// then serialize an array of GsNMethods as tab-separated lines.
// envId parameter controls which environment to use for categoryOfSelector:.
function methodSerialization(envId: number | string): string {
  return `sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
limit := methods size min: 500.
1 to: limit do: [:i |
  | each cls baseClass |
  each := methods at: i.
  cls := each inClass.
  baseClass := cls theNonMetaClass.
  stream
    nextPutAll: (classDict at: baseClass ifAbsent: ['']); tab;
    nextPutAll: baseClass name; tab;
    nextPutAll: (cls isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
    nextPutAll: each selector; tab;
    nextPutAll: ((cls categoryOfSelector: each selector environmentId: ${envId}) ifNil: ['']); lf.
].
stream contents`;
}

function parseMethodSearchResults(raw: string): MethodSearchResult[] {
  const results: MethodSearchResult[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    results.push({
      dictName: parts[0],
      className: parts[1],
      isMeta: parts[2] === '1',
      selector: parts[3],
      category: parts[4],
    });
  }
  return results;
}

export function searchMethodSource(
  session: ActiveSession, term: string, ignoreCase: boolean,
): MethodSearchResult[] {
  const code = `| results methods stream limit classDict sl |
results := ClassOrganizer new substringSearch: '${escapeString(term)}' ignoreCase: ${ignoreCase}.
methods := results at: 1.
${methodSerialization(0)}`;

  return parseMethodSearchResults(
    executeFetchString(session, `searchMethodSource('${term}')`, code),
  );
}

export function sendersOf(
  session: ActiveSession, selector: string, environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${environmentId}; yourself)
  sendersOf: #'${escapeString(selector)}') at: 1.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(
    executeFetchString(session, `sendersOf(#${selector}, env:${environmentId})`, code),
  );
}

export function implementorsOf(
  session: ActiveSession, selector: string, environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${environmentId}; yourself)
  implementorsOf: #'${escapeString(selector)}') asArray.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(
    executeFetchString(session, `implementorsOf(#${selector}, env:${environmentId})`, code),
  );
}

export interface ClassHierarchyEntry {
  className: string;
  dictName: string;
  kind: 'superclass' | 'self' | 'subclass';
}

export function getClassHierarchy(
  session: ActiveSession, className: string,
): ClassHierarchyEntry[] {
  const code = `| organizer class supers subs stream classDict sl |
organizer := ClassOrganizer new.
class := System myUserProfile symbolList objectNamed: #'${escapeString(className)}'.
supers := organizer allSuperclassesOf: class.
subs := organizer subclassesOf: class.
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
supers reverseDo: [:each |
  stream nextPutAll: (classDict at: each ifAbsent: ['']); tab;
    nextPutAll: each name; tab; nextPutAll: 'superclass'; lf].
stream nextPutAll: (classDict at: class ifAbsent: ['']); tab;
  nextPutAll: class name; tab; nextPutAll: 'self'; lf.
subs asSortedCollection do: [:each |
  stream nextPutAll: (classDict at: each ifAbsent: ['']); tab;
    nextPutAll: each name; tab; nextPutAll: 'subclass'; lf].
stream contents`;

  const raw = executeFetchString(session, `getClassHierarchy(${className})`, code);
  const results: ClassHierarchyEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      dictName: parts[0],
      className: parts[1],
      kind: parts[2] as 'superclass' | 'self' | 'subclass',
    });
  }
  return results;
}

export function compileMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  category: string,
  source: string,
  environmentId: number = 0,
): bigint {
  const recv = receiver(className, isMeta);
  logQuery(session.id, `compileMethod(${recv}, '${category}')`, source);

  // Resolve the base class OOP
  const { result: baseClassOop, err: resolveErr } = session.gci.GciTsResolveSymbol(
    session.handle, className, OOP_NIL,
  );
  if (resolveErr.number !== 0) {
    throw new BrowserQueryError(
      resolveErr.message || `Cannot resolve ${className}`, resolveErr.number
    );
  }

  // For class side, send #class to get the metaclass OOP
  let classOop = baseClassOop;
  if (isMeta) {
    const { result: metaOop, err: metaErr } = session.gci.GciTsPerform(
      session.handle, baseClassOop, OOP_ILLEGAL, 'class', [], 0, 0,
    );
    if (metaErr.number !== 0) {
      throw new BrowserQueryError(
        metaErr.message || `Cannot get metaclass for ${className}`, metaErr.number
      );
    }
    classOop = metaOop;
  }

  // Create source String OOP
  const { result: sourceOop, err: srcErr } = session.gci.GciTsNewString(
    session.handle, source,
  );
  if (srcErr.number !== 0) {
    throw new BrowserQueryError(
      srcErr.message || 'Cannot create source string', srcErr.number
    );
  }

  // Create category Symbol OOP
  const { result: catOop, err: catErr } = session.gci.GciTsNewSymbol(
    session.handle, category,
  );
  if (catErr.number !== 0) {
    throw new BrowserQueryError(
      catErr.message || 'Cannot create category symbol', catErr.number
    );
  }

  // Compile the method
  const { result: methodOop, err: compileErr } = session.gci.GciTsCompileMethod(
    session.handle,
    sourceOop,
    classOop,
    catOop,
    OOP_NIL,       // symbolList (use default)
    OOP_NIL,       // overrideSelector
    0,             // compileFlags
    environmentId,
  );
  if (compileErr.number !== 0) {
    if (compileErr.context !== OOP_NIL && compileErr.context !== 0n) {
      try { session.gci.GciTsClearStack(session.handle, compileErr.context); } catch { /* ignore */ }
    }
    const msg = compileErr.message || `Compile error ${compileErr.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, compileErr.number);
  }

  logResult(session.id, `Compiled → OOP ${methodOop}`);
  return methodOop;
}
