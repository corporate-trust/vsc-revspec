import * as vscode from 'vscode';
import { getTextDocumentByUri } from './scopeProvider';
import { EFAULT } from 'constants';

export var findingId = 0;
let sumReducer = (accumulator: number, currentValue: vscode.Range) => accumulator + (currentValue.end.line - currentValue.start.line);

export function setFindingId(x: number) {
    findingId = x;
}

export class Finding {
	constructor(
		public title: string | undefined,
		public body: string | undefined,
		public severity: string | undefined,
		public likelihood: string | undefined,
		public author: string | undefined,
        public range: vscode.Range,
        public id: number | undefined
	) {
        if (id === undefined) {
            id = ++findingId;
        }
	}
}

export class ScopeItem extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public document: vscode.TextDocument | undefined,
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
        if (seen === undefined) {
            seen = [];
        }
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
        if (this.document === undefined) {
            this.document = getTextDocumentByUri(this.resourceUri);
        }
        if (this.document !== undefined) {
            return {
                lines: this.document.lineCount,
                seenLines: this.seen.reduce(sumReducer, 0)
            };
        } else {
            return {
                lines: 1,
                seenLines: 0
            };
        }
    }

    getAcceptedStats() {
        if (this.document === undefined) {
            this.document = getTextDocumentByUri(this.resourceUri);
        }
        if (this.document !== undefined) {
            return {
                lines: this.document.lineCount,
                acceptedLines: this.accepted.reduce(sumReducer, 0)
            };
        } else {
            return {
                lines: 1,
                acceptedLines: 0
            };
        }
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