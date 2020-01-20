import * as vscode from 'vscode';
import { ScopeItem } from './scopeProvider';
import { scopeProvider, Finding } from './extension';

export class ReportProvider implements vscode.TextDocumentContentProvider {
// TODO: overall stats
// TODO: Converter von markdown zu word
    private _onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri) {
        let text = "# Report\n\n";
        text += "## Scope\n\n";
        text += "Files in scope: " + scopeProvider.scope.length + "\n";
        scopeProvider.scope.forEach((sf: ScopeItem) => {
            let uri = vscode.workspace.asRelativePath(sf.resourceUri);
            let ps = Math.ceil((sf.getSeenStats().seenLines / sf.getSeenStats().lines) * 100);
            let pa = Math.ceil((sf.getAcceptedStats().acceptedLines / sf.getAcceptedStats().lines) * 100);
            text += `* ${uri}\n\t* ${ps}% of the file has been seen\n\t* ${pa}% of the code has been accepted`;
            text += "\n";
        });

        // Findings
        text += "\n---\n\n\n";
        text += "## Findings\n\n";
        text += `* ${scopeProvider.getFindingsCount()} problems have been found\n\n`;
        scopeProvider.scope.forEach((sf: ScopeItem) => {
            sf.findings.sort((a: Finding, b: Finding) => {
                let astat = Number(a.likelihood) * Number(a.severity);
                let bstat = Number(b.likelihood) * Number(a.severity);
                if (astat < bstat) {
                    return 1;
                }
                if (astat > bstat) {
                    return -1;
                }
                return 0;
            });
            sf.findings.forEach((f: Finding) => {
                text += "### " + f.id + " - " + f.title + "\n";
                text += `* ${vscode.workspace.asRelativePath(sf.document.uri)} (l.${f.range.start.line}-${f.range.end.line})\n`;
                text += "* Severity: " + f.severity + "\n";
                text += "* Likelihood: " + f.likelihood + "\n";
                text += `* Reviewer: ${f.author}\n\n`;
                text += f.body + "\n\n";
                text += "```\n";
                text += sf.document.getText(f.range);
                text += "\n```\n\n";
            });
        });
        return text;
    }
}