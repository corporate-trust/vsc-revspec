import * as vscode from 'vscode';
import { ScopeFile } from './scopeProvider';
import { scopeProvider, Finding } from './extension';

export class ReportProvider implements vscode.TextDocumentContentProvider {

    private _onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri) {
        let text = "# Report\n\n";
        text += "## Scope\n\n";
        text += "Files in scope: " + scopeProvider.scope.length + "\n";
        scopeProvider.scope.forEach((sf: ScopeFile) => {
            let uri = vscode.workspace.asRelativePath(sf.resourceUri);
            let ps = Math.ceil((sf.getSeenStats().seenLines / sf.getSeenStats().lines) * 100);
            let pa = Math.ceil((sf.getAcceptedStats().acceptedLines / sf.getAcceptedStats().lines) * 100);
            text += `* ${uri}\n\t* ${ps}% of the file has been seen\n\t* ${pa}% of the code has been accepted`;
            text += "\n";
        });

        // Findings
        text += "\n## Findings\n\n"
        scopeProvider.scope.forEach((sf: ScopeFile) => {
            text += "---\n\n";
            sf.findings.forEach((f: Finding) => {
                text += "ID: " + f.id + "\n";
                text += f.body + "\n";
            });
        });
        return text;
    }
}