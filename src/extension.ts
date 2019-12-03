// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ScopeProvider, ScopeFile } from './scopeProvider';
import { ReportProvider } from './report';
import { REPL_MODE_SLOPPY } from 'repl';

let markerId = 1;
let currentSeenProgress: vscode.StatusBarItem;
let currentAcceptedProgress: vscode.StatusBarItem;
let reviewer: String;

export let scopeProvider: ScopeProvider;

export class Finding implements vscode.Comment {
	id: number;
	label: string | undefined;
	constructor(
		public body: string | vscode.MarkdownString,
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public parent?: vscode.CommentThread,
		public contextValue?: string
	) {
		this.id = ++markerId;
	}
}

function setup_session() {
	vscode.window.showInformationMessage('Setup review session!');
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
	let addFileToScope = vscode.commands.registerCommand('revspec.addfiletoscope', add_file_to_scope);

	context.subscriptions.push(setupSession);
	context.subscriptions.push(addFileToScope);

	// Findings are made by comments
	const commentController = vscode.comments.createCommentController('revspec-marker', 'Marker for revspec extension');
	context.subscriptions.push(commentController);

	commentController.commentingRangeProvider = {
		provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
			let lineCount = document.lineCount;
			return [new vscode.Range(0, 0, lineCount - 1, 0)];
		}
	};

	//commentController.reactionHandler = commentReactionHandler;

	context.subscriptions.push(vscode.commands.registerCommand('revspec.findings.create', (reply: vscode.CommentReply) => {
		let editor = vscode.window.activeTextEditor;
		if (editor) {
			createFinding(reply, editor);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('revspec.findings.delete', (thread: vscode.CommentThread) => {
		thread.dispose();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('revspec.findings.deleteComment', (comment: Finding) => {
		let thread = comment.parent;
		if (!thread) {
			return;
		}
		thread.comments = thread.comments.filter(cmt => (cmt as Finding).id !== comment.id);
		if (thread.comments.length === 0) {
			thread.dispose();
		}
	}));

	/*context.subscriptions.push(vscode.commands.registerCommand('revspec.saveMarker', (comment: MarkerComment) => {
		return;
	}));*/

	// Scope container
	scopeProvider = new ScopeProvider();
	vscode.window.registerTreeDataProvider('revspec-scope', scopeProvider);
	
	addFileToScope = vscode.commands.registerCommand('revspec.scope.addFile', () => {
		let document = vscode.window.activeTextEditor.document;
		if (!document) {
			return;
		}
		scopeProvider.addTreeItem(document);
	});
	context.subscriptions.push(addFileToScope);

	let removeFileCommand = vscode.commands.registerCommand('revspec.scope.removeFile', (sf: ScopeFile) => {
		scopeProvider.removeItemFromScope(sf);
	});
	context.subscriptions.push(removeFileCommand);

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

	// Report
	const reportScheme = 'report';
	const report = new ReportProvider;
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(reportScheme, report));

	let getReport = vscode.commands.registerCommand('revspec.report.get', async () => {
		let uri = vscode.Uri.parse('report:' + 'r');
		let doc = await vscode.workspace.openTextDocument(uri);
		vscode.window.showTextDocument(doc, { preview: true });
	});
	context.subscriptions.push(getReport);
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


function createFinding(reply: vscode.CommentReply, editor: vscode.TextEditor) {
	let thread = reply.thread;
	
	let newComment = new Finding(reply.text, vscode.CommentMode.Preview, { name: 'vscode' }, thread, thread.comments.length ? 'canDelete' : undefined);
	if (thread.contextValue === 'draft') {
		newComment.label = 'pending';
	}
	thread.comments = [...thread.comments, newComment];
	let sf = scopeProvider.getScopeFileByUri(editor.document.uri);
	sf.addFinding(newComment);
}

/*function commentReactionHandler(comment: vscode.Comment, reaction: vscode.CommentReaction): Promise<void> {
	return new Promise();
}*/

// this method is called when your extension is deactivated
export function deactivate() { }
