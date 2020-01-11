// TODO: Setup session -> all documents get readonly
// TODO: Open preview instead of markdown --> Requesting markdown support on installation?

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ScopeProvider, ScopeFile } from './scopeProvider';
import { ReportProvider } from './report';
import { REPL_MODE_SLOPPY } from 'repl';

let markerId = 0;
let currentSeenProgress: vscode.StatusBarItem;
let currentAcceptedProgress: vscode.StatusBarItem;
export let reviewer: string;
let findingsHoverProvider: vscode.HoverProvider;

export let scopeProvider: ScopeProvider;

export class Finding {
	id: number;
	constructor(
		public title: string | undefined,
		public body: string | undefined,
		public severity: string | undefined,
		public likelihood: string | undefined,
		public author: string | undefined,
		public range: vscode.Range
	) {
		this.id = ++markerId;
	}
}

async function setup_session() {
	vscode.window.showInformationMessage('Setup review session!');
	const reviewer_name = await vscode.window.showInputBox({
		prompt: "Reviewers name"
	});
	if (reviewer_name) {
		reviewer = reviewer_name;
	}
}

function add_file_to_scope() {
	let editor = vscode.window.activeTextEditor;
	if (editor) {
		let document = editor.document;
		vscode.window.showInformationMessage('Adding current file to scope '.concat(document.fileName.toString()));
	}
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "revspec" is now active!');

	let setupSession = vscode.commands.registerCommand('revspec.setupsession', setup_session);
	context.subscriptions.push(setupSession);

	// Scope container
	scopeProvider = new ScopeProvider();
	vscode.window.registerTreeDataProvider('revspec-scope', scopeProvider);
	
	let addFileToScope = vscode.commands.registerCommand('revspec.scope.addFile', () => {
		let editor = vscode.window.activeTextEditor;
		if (!editor || !editor.document) {
			return;
		}
		scopeProvider.addTreeItem(editor.document);
	});
	context.subscriptions.push(addFileToScope);

	let removeFileCommand = vscode.commands.registerCommand('revspec.scope.removeFile', (sf: ScopeFile) => {
		scopeProvider.removeItemFromScope(sf);
	});
	context.subscriptions.push(removeFileCommand);

	let addToScope = vscode.commands.registerCommand('revspec.scope.add', async (operationId: string, entry: vscode.Uri[]) => scopeProvider.addToScope(operationId, entry));
	context.subscriptions.push(addToScope);

	// Accepted
	let addAccepted = vscode.commands.registerCommand('revspec.addAccepted', () => {
		let e = vscode.window.activeTextEditor;
		if (e !== undefined) {
			let s = e.selection;
			scopeProvider.addAccepted(e.document, s);
		}
	});
	context.subscriptions.push(addAccepted);

	// Status bar progress information

	currentSeenProgress = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
	context.subscriptions.push(currentSeenProgress);

	currentAcceptedProgress = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10001);
	context.subscriptions.push(currentAcceptedProgress);

	// Event listening
	vscode.window.onDidChangeTextEditorVisibleRanges( (e) => {
		scopeProvider.didChangeTextEditorVisibleRanges(e);
	});

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBarItemProgress));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBarItemAccepted));
	updateStatusBarItemProgress();
	updateStatusBarItemAccepted();

	vscode.window.onDidChangeVisibleTextEditors( (e) => {
		scopeProvider.updateDecorations();
	});
	scopeProvider.updateDecorations();

	// New findings
	let newFinding = vscode.commands.registerTextEditorCommand('revspec.findings.new', () => createFinding());
	context.subscriptions.push(newFinding);

	let deleteFinding = vscode.commands.registerTextEditorCommand('revspec.findings.delete', () => removeFinding());
	context.subscriptions.push(deleteFinding);

	// Report
	const reportScheme = 'report';
	const report = new ReportProvider;
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(reportScheme, report));

	let getReport = vscode.commands.registerCommand('revspec.report.get', async () => {
		let uri = vscode.Uri.parse('report:' + 'report.md');
		let doc = await vscode.workspace.openTextDocument(uri);
		vscode.window.showTextDocument(doc, { preview: true });
	});
	context.subscriptions.push(getReport);

	findingsHoverProvider = {
		provideHover(doc, pos): vscode.ProviderResult<vscode.Hover> {
			let sf = scopeProvider.getScopeFileByUri(doc.uri);
			if (sf) {
				for (var i = 0; i < sf.findings.length; i++) {
					let s = sf.findings[i];
					if (s.range.contains(pos)) {
						if (s.body !== undefined) {
							let m = new vscode.MarkdownString(`### ${s.id} - ${s.title}\n---\n* Likelihood: ${s.likelihood}\n* Severity: ${s.severity}\n---\n${s.body}`);
							return new vscode.Hover(m, s.range);
						}
					}
				}
			}
			return;
		}
	};
	context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file', pattern: '**/*' }, findingsHoverProvider));
}

export function updateStatusBarItemProgress() {
	let e = (vscode.window.activeTextEditor);
	let sp = "File not in scope";
	let ap = 0;
	if (e !== undefined) {
		let u = e.document.uri;
		let sf = scopeProvider.getScopeFileByUri(u);
		if (sf !== null) {
			let {lines, seenLines} = sf.getSeenStats();
			sp = `${Math.ceil(((seenLines / lines) * 100))}%`;
		}
	}
	let reducer = (accumulator: number, currentValue: ScopeFile) => accumulator + currentValue.getSeenStats().lines;
	let lines = scopeProvider.scope.reduce(reducer, 0);
	if (lines !== 0) {
		reducer = (accumulator: number, currentValue: ScopeFile) => accumulator + currentValue.getSeenStats().seenLines;
		let seenLines = scopeProvider.scope.reduce(reducer, 0);
		ap = Math.ceil(((seenLines / lines) * 100));
	}
	currentSeenProgress.text = `Seen: ${ap}% | ${sp}`;
	currentSeenProgress.show();
}

export function updateStatusBarItemAccepted() {
	let e = vscode.window.activeTextEditor;
	let sp = "File not in scope";
	let ap = 0;
	if (e !== undefined) {
		let u = e.document.uri;
		let sf = scopeProvider.getScopeFileByUri(u);
		if (sf !== null) {
			let {lines, acceptedLines} = sf.getAcceptedStats();
			sp = `${Math.ceil(((acceptedLines / lines) * 100))}%`;
		}
	}
	let reducer = (accumulator: number, currentValue: ScopeFile) => accumulator + currentValue.getAcceptedStats().lines;
	let lines = scopeProvider.scope.reduce(reducer, 0);
	if (lines !== 0) {
		reducer = (accumulator: number, currentValue: ScopeFile) => accumulator + currentValue.getAcceptedStats().acceptedLines;
		let acceptedLines = scopeProvider.scope.reduce(reducer, 0);
		ap = Math.ceil(((acceptedLines / lines) * 100));
	}
	currentAcceptedProgress.text = `Accepted: ${ap}% | ${sp}`;
	currentAcceptedProgress.show();
}

function removeFinding() {
	let id = Promise.resolve(deleteFindingDialog()).then((value) => {
		scopeProvider.deleteFindingByID(value);
	});
	scopeProvider.updateDecorations();
}

async function deleteFindingDialog() {
	let id_s = await vscode.window.showInputBox({
		prompt: "Finding ID to delete",
		validateInput: value => {
			if (Number.isInteger(Number(value))) {
				let id = Number(value);
				if (scopeProvider.getFindingByID(id) !== null) {
					return null;
				} else {
					return `Finding with ID ${id} does not exist!`;
				}
			} else {
				return 'Numbers only!';
			}
		}
	});
	let id = Number(id_s);
	return id;
}

function createFinding() {
	let editor = vscode.window.activeTextEditor;
	if (editor !== undefined) {
		let sf = scopeProvider.getScopeFileByUri(editor.document.uri);
		if (sf !== null) {
			let range = editor.selection;
			if (!range.isEmpty) {
				Promise.resolve(newFindingDialog(editor.document, range)).then((value) => {
					if (sf) {
						sf.addFinding(value);
					}
					vscode.window.showInformationMessage(`Created finding with ID ${value.id}`);
				});
			} else {
				vscode.window.showErrorMessage("First select code containing the bug to create a new finding!");
			}
		} else {
			vscode.window.showErrorMessage("This file is not in scope!");
		}
	}
	scopeProvider.updateDecorations();
}
// FIXME: Findings erzeugung abbrechbar machen
// FIXME: Ordentliches multipart input verwenden
export async function newFindingDialog(editor: vscode.TextDocument, range: vscode.Range) {
	const title = await vscode.window.showInputBox({
		prompt: "Finding title",
		ignoreFocusOut: true,
		placeHolder: "For example: Buffer overflow at ..."
	});
	const description = await vscode.window.showInputBox({
		prompt: "Description",
		ignoreFocusOut: true
	});
	const likelihood = await vscode.window.showInputBox({
		prompt: "Liklihood",
		ignoreFocusOut: true,
		validateInput: (value) => {
			return (Number.isInteger(Number(value))) ? null : 'Numbers only!';
		}
	});
	const severity = await vscode.window.showInputBox({
		prompt: "Severity",
		ignoreFocusOut: true,
		validateInput: (value) => {
			return (Number.isInteger(Number(value))) ? null : 'Numbers only!';
		}
	});
	let f = new Finding(title, description, severity, likelihood, reviewer, range);
	return f;
}

// this method is called when your extension is deactivated
export function deactivate() { }
