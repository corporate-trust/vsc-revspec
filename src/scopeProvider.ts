import * as vscode from 'vscode';
import fs from 'fs';
import { updateStatusBarItemProgress, updateStatusBarItemAccepted, Finding, reviewer, scopeProvider } from './extension';

const seenDecorationType = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: {id: 'revspec.scope.seen'},
    overviewRulerLane: vscode.OverviewRulerLane.Right
});

const acceptedDecoratorType = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: {id: 'revspec.scope.accepted'},
    backgroundColor: {id: 'revspec.scope.accepted'}
});

const findingDecoratorType = vscode.window.createTextEditorDecorationType({
    border: "2px",
    borderColor: {id: "revspec.finding"},
    borderStyle: "none none solid none"
});

let sumReducer = (accumulator: number, currentValue: vscode.Range) => accumulator + (currentValue.end.line - currentValue.start.line);
let findingsReducer = (accumulator: number, currentValue: ScopeFile) => accumulator + currentValue.findings.length;

export class ScopeProvider implements vscode.TreeDataProvider<ScopeFile> {
    private _onDidChangeTreeData: vscode.EventEmitter<ScopeFile | undefined> = new vscode.EventEmitter<ScopeFile | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ScopeFile | undefined> = this._onDidChangeTreeData.event;

    scope: ScopeFile[];

    constructor () {
        this.scope = [];
    }

    refresh(): void {
        this.scope.sort((sf1, sf2) => {
            if (sf1.resourceUri < sf2.resourceUri) {
                return -1;
            }
            if (sf1.resourceUri > sf2.resourceUri) {
                return 1;
            }
            return 0;
        });
        this._onDidChangeTreeData.fire();
    }

    async addToScope(operationId: string, entry: vscode.Uri[]) {
        entry.forEach(async (e) => {
            let s = await vscode.workspace.fs.stat(e);
            if (s.type === vscode.FileType.File) {
                let d = await vscode.workspace.openTextDocument(e);
                this.addTreeItem(d);
            } else if (s.type === vscode.FileType.Directory) {
                let p = vscode.workspace.asRelativePath(e.fsPath) + "/*";
                let uris = await vscode.workspace.findFiles(p);
                uris.forEach(async (u) => {
                    let d = await vscode.workspace.openTextDocument(u);
                    this.addTreeItem(d);
                });
            }
        });
        this.refresh();
    }

    addTreeItem(document: vscode.TextDocument) {
        let label = document.uri;
        if (this.getScopeFileByUri(document.uri) === null) {
            this.scope.push(new ScopeFile(label, 0, document, [], [], []));
            this.refresh();
            updateStatusBarItemAccepted();
            updateStatusBarItemProgress();
            this.updateDecorations();
            vscode.window.showInformationMessage(`Added file to scope`);
        } else {
            vscode.window.showErrorMessage("This file is already in scope");
        }
    }

    getTreeItem(element: ScopeFile): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ScopeFile): Thenable<ScopeFile[]> {
        return Promise.resolve(this.scope);
    }

    removeItemFromScope(element: ScopeFile) {
        const index = this.scope.indexOf(element, 0);
        if (index > -1) {
            this.scope.splice(index);
        }
        this.refresh();
    }

    getIndexByUri(uri: vscode.Uri) {
        for (var i = 0; i < this.scope.length; i++) {
            if (this.scope[i].resourceUri.path === uri.path) {
                return i;
            }
        }
        return -1;
    }

    getScopeFileByUri(uri: vscode.Uri) {
        for (var i = 0; i < this.scope.length; i++) {
            if (this.scope[i].resourceUri.path === uri.path) {
                return this.scope[i];
            }
        }
        return null;
    }

    didChangeTextEditorVisibleRanges(e: vscode.TextEditorVisibleRangesChangeEvent) {
        // Update scopefile of corresponding textdocument
        let i = this.getIndexByUri(e.textEditor.document.uri);
        if (i >= 0) {
            let sf = this.scope[i];
            e.visibleRanges.forEach( (r) => {
                sf.addSeenRange(r);
            });
            this.updateDecorations();
        }
        updateStatusBarItemProgress();
    }

    addAccepted(e: vscode.TextDocument, r: vscode.Range) {
        let sf = this.getScopeFileByUri(e.uri);
        if (sf !== null) {
            sf.addAcceptedRange(r);
        }
        this.updateDecorations();
        updateStatusBarItemAccepted();
    }

    getFindingsCount() {
        return this.scope.reduce(findingsReducer, 0);
    }

    getFindingByID(id: number) {
        let x = this.scope.filter(sf => (
            sf.getFindingByID(id) !== null
        ));
        if (x.length > 0) {
            return x[0];
        } else {
            return null;
        }
    }

    deleteFindingByID(id: number) {
        this.scope.forEach((sf) => {
            sf.deleteFindingByID(id);
        });
    }

    updateDecorations() {
        vscode.window.visibleTextEditors.forEach((editor) => {
            let sf = this.getScopeFileByUri(editor.document.uri);
            if (sf) {
                editor.setDecorations(seenDecorationType, sf.seen);
                editor.setDecorations(acceptedDecoratorType, sf.accepted);
                editor.setDecorations(findingDecoratorType, sf.findings);
            }
        });
    }
}


export class ScopeFile extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public document: vscode.TextDocument,
        public seen: vscode.Range[],
        public accepted: vscode.Range[],
        public findings: Finding[]
    ) {
        super(resourceUri, collapsibleState);
        this.command = {
            command: 'vscode.open',
            title: '',
            arguments: [resourceUri]
        };
    }

    refreshSeen() {
        if (this.seen) {
            this.seen.sort((a: vscode.Range, b: vscode.Range) => {
                return a.start.compareTo(b.start);
            });
        }
    }

    refreshAccepted() {
        if (this.accepted) {
            this.accepted.sort((a: vscode.Range, b: vscode.Range) => {
                return a.start.compareTo(b.start);
            });
        }
    }

    getSeenStats() {
        return {
            lines: this.document.lineCount,
            seenLines: this.seen.reduce(sumReducer, 0)
        };
    }

    getAcceptedStats() {
        return {
            lines: this.document.lineCount,
            acceptedLines: this.accepted.reduce(sumReducer, 0)
        };
    }
    
    // Add a range to the reviewed scope
    addSeenRange(new_r: vscode.Range) {
        this.seen.push(new_r);
        this.refreshSeen();
        for (var i = 0; i < this.seen.length; i++) {
            try {
                while (this.seen[i].end.isAfterOrEqual(this.seen[i+1].start)) {
                    this.seen[i] = this.seen[i].union(this.seen[i+1]);
                    this.seen.splice(i+1,1);
                }
            } catch(e) {
                return;
            }
        }
    }

    addAcceptedRange(new_r: vscode.Range) {
        this.accepted.push(new_r);
        this.refreshAccepted();
        for (var i = 0; i < this.accepted.length; i++) {
            try {
                while (this.accepted[i].end.isAfterOrEqual(this.accepted[i+1].start)) {
                    this.accepted[i] = this.accepted[i].union(this.accepted[i+1]);
                    this.accepted.splice(i+1,1);
                }
            } catch(e) {
                return;
            }
        }
    }

    addFinding(f: Finding) {
        this.accepted = this.accepted.filter(a => 
            (a.intersection(f.range) === undefined) && (!(a.contains(f.range)))
        );
        this.findings.push(f);
        scopeProvider.updateDecorations();
    }

    getFindingByID(id: number) {
        let f =  this.findings.filter(f => f.id === id);
        if (f.length > 0) {
            return f[0];
        } else {
            return null;
        }
    }

    deleteFindingByID(id: number) {
        this.findings = this.findings.filter(f => f.id !== id);
    }
}