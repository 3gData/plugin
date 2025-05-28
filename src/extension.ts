import * as vscode from 'vscode';
import * as path from 'path';

const outputChannel = vscode.window.createOutputChannel('Framework Service Completion');

interface ModuleDef {
  name: string;
  folder: string;  // Client or Server
  subFolder: string;  // The subfolder under Framework (e.g., "Service", "UI", etc.)
  fullName: string;
  uri: vscode.Uri;
}

let frameworkIndex: ModuleDef[] = [];

/** Scan workspace for all Framework modules under Client and Server folders. */
async function scanFramework() {
  outputChannel.appendLine('Starting Framework scan...');
  frameworkIndex = [];
  // match paths in src/Client and src/Server
  const files = await vscode.workspace.findFiles('{src/Client/**/[SC]_*.lua,src/Server/**/[SC]_*.lua}');
  outputChannel.appendLine(`Found ${files.length} potential framework files`);
  
  for (const uri of files) {
    const parts = uri.fsPath.split(path.sep);
    // Check if path contains either Client or Server
    const isClient = parts.includes('Client');
    const isServer = parts.includes('Server');
    if ((isClient || isServer) && parts.length >= 2) {
      const folder = isClient ? 'Client' : 'Server';
      const fullName = parts[parts.length - 1];              // e.g. "S_Grid.lua"
      const name = fullName.replace(/^[SC]_(.+)\.lua$/, '$1');
      
      // Find the subfolder path after Client/Server
      const folderIndex = parts.indexOf(folder);
      const subFolderParts = parts.slice(folderIndex + 1, -1); // Get all folders between Client/Server and the file
      const subFolder = subFolderParts.join('.');
      
      frameworkIndex.push({ name, folder, subFolder, fullName, uri });
      outputChannel.appendLine(`  Indexed: ${folder}.${subFolder}.${name}`);
    }
  }
  outputChannel.appendLine(`Scan complete. Found ${frameworkIndex.length} framework modules`);
}

export function activate(ctx: vscode.ExtensionContext) {
  outputChannel.show();
  outputChannel.appendLine('Framework Service Completion extension activated');
  vscode.window.showInformationMessage('Framework Service Completion extension is now active');
  
  // Add command to show debug output
  ctx.subscriptions.push(
    vscode.commands.registerCommand('framework-completion.showOutput', () => {
      outputChannel.show();
      vscode.window.showInformationMessage('Debug output panel shown. Look for "Framework Service Completion" in the Output dropdown.');
    })
  );
  
  // (Re)scan on activate and on workspace change
  scanFramework();
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      outputChannel.appendLine('Workspace changed, rescanning...');
      scanFramework();
    })
  );

  // Register completion provider for 'lua'
  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'file', language: 'lua' },
      {
        provideCompletionItems(document, position) {
          const line = document.lineAt(position.line).text;
          const prefix = line.slice(0, position.character);
          outputChannel.appendLine(`\nCompletion triggered at position ${position.character}`);
          outputChannel.appendLine(`Full line: "${line}"`);
          outputChannel.appendLine(`Prefix: "${prefix}"`);
          
          // Check if we're after 'auto.' - more lenient regex
          const m = prefix.match(/auto\.(\w*)$/);
          outputChannel.appendLine(`Regex match: ${JSON.stringify(m)}`);
          
          if (!m) {
            outputChannel.appendLine('  No "auto." pattern found');
            return undefined;
          }

          // Determine if we're in a Client or Server file
          const filePath = document.uri.fsPath;
          const isClientFile = filePath.includes('Client');
          const isServerFile = filePath.includes('Server');
          outputChannel.appendLine(`File context: ${isClientFile ? 'Client' : isServerFile ? 'Server' : 'Unknown'}`);
          
          const query = m[1].toLowerCase();
          outputChannel.appendLine(`  Searching for completions matching "${query}"`);
          
          const items: vscode.CompletionItem[] = [];
          for (const def of frameworkIndex) {
            // Only show Client services in Client files and Server services in Server files
            if ((isClientFile && def.folder !== 'Client') || (isServerFile && def.folder !== 'Server')) {
              continue;
            }

            const serviceName = def.name.toLowerCase();
            outputChannel.appendLine(`  Checking against ${def.folder}.${def.subFolder}.${def.name} (${serviceName})`);
            
            // Show all items after auto. or if there's a partial match
            if (!query || serviceName.includes(query)) {
              const item = createCompletionItem(def, position, document);
              
              // Only add additionalTextEdits if the service isn't already imported
              if (!isServiceAlreadyImported(document, def.name)) {
                item.additionalTextEdits = makeAdditionalEdits(document, position, def);
              }
              
              items.push(item);
              outputChannel.appendLine(`    Found match: ${def.folder}.${def.subFolder}.${def.name} (${isServiceAlreadyImported(document, def.name) ? 'already imported' : 'not imported'})`);
            }
          }
          
          if (items.length === 0 && query.length > 0) {
            outputChannel.appendLine('  No matches found');
            vscode.window.setStatusBarMessage(`No matching Framework services found for '${query}'`, 3000);
          } else {
            outputChannel.appendLine(`  Returning ${items.length} completion items`);
          }
          
          return items;
        }
      },
      '.' // trigger character
    )
  );
  
  // Add a command to manually rescan
  const rescanCommand = vscode.commands.registerCommand('framework-completion.rescan', () => {
    outputChannel.appendLine('Manual rescan requested');
    scanFramework();
    vscode.window.showInformationMessage('Framework modules rescanned');
  });
  ctx.subscriptions.push(rescanCommand);
}

/** Check if a service is already imported in the file */
function isServiceAlreadyImported(document: vscode.TextDocument, serviceName: string): boolean {
  const text = document.getText();
  // Check for type definition
  const typeRegex = new RegExp(`local\\s+${serviceName}Type\\s*:`);
  // Check for service assignment
  const assignRegex = new RegExp(`local\\s+${serviceName}\\s*:`);
  
  return typeRegex.test(text) || assignRegex.test(text);
}

function createCompletionItem(def: ModuleDef, position: vscode.Position, document: vscode.TextDocument): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    def.name,
    vscode.CompletionItemKind.Class
  );
  
  const isImported = isServiceAlreadyImported(document, def.name);
  if (isImported) {
    item.detail = `Framework.${def.folder}.${def.subFolder}.${def.name} (already imported)`;
    item.documentation = new vscode.MarkdownString(`Framework ${def.folder} service: ${def.subFolder}.${def.name}\n\n**Note:** This service is already imported in this file.`);
    // Use different color/style for already imported services
    item.kind = vscode.CompletionItemKind.Reference;
  } else {
    item.detail = `Framework.${def.folder}.${def.subFolder}.${def.name}`;
    item.documentation = new vscode.MarkdownString(`Framework ${def.folder} service: ${def.subFolder}.${def.name}`);
  }
  
  // Find where the 'auto.' starts
  const text = def.name;
  const range = new vscode.Range(
    position.line, Math.max(0, position.character - 5), // 5 is length of "auto."
    position.line, position.character
  );
  
  item.insertText = text;
  item.range = range;
  
  // Set high priority
  item.sortText = (isImported ? '1' : '0') + def.name; // Put non-imported items first
  item.preselect = !isImported; // Preselect only non-imported items
  item.filterText = 'auto.' + def.name.toLowerCase();
  
  outputChannel.appendLine(`    Created completion item: ${def.name} (${item.detail})`);
  return item;
}

/**
 * Build the three edits:
 * 1) Insert `local FooType = typeof(require(...))` after local FrameworkObject=...
 * 2) Insert `local Foo: FooType`
 * 3) Insert `Foo = Framework.<folder>.Foo` after module.Init()
 */
function makeAdditionalEdits(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  def: ModuleDef
): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];
  const text = doc.getText().split(/\r?\n/);

  // 1) find "local FrameworkObject =" line
  let topLine = 0;
  for (let i = 0; i < text.length; i++) {
    if (/^\s*local\s+FrameworkObject\s*=/.test(text[i])) {
      topLine = i;
      break;
    }
  }
  
  // Build the full path for the type
  const typePath = def.subFolder ? `FrameworkObject.${def.subFolder}.${def.fullName.replace(/\.lua$/, '')}` : `FrameworkObject.${def.fullName.replace(/\.lua$/, '')}`;
  
  // insert type alias + typed local
  const aliasLine = `local ${def.name}Type = typeof(require(${typePath}))`;
  const localLine = `local ${def.name}: ${def.name}Type`;
  edits.push(vscode.TextEdit.insert(
    new vscode.Position(topLine + 1, 0),
    aliasLine + '\n' + localLine + '\n'
  ));

  // 2) find "function module.Init"
  let initLine = -1;
  for (let i = 0; i < text.length; i++) {
    if (/^\s*function\s+module\.Init/.test(text[i])) {
      initLine = i;
      break;
    }
  }
  if (initLine >= 0) {
    // Build the full path for the assignment
    const assignPath = def.subFolder ? `Framework.${def.subFolder}.${def.name}` : `Framework.${def.name}`;
    
    // insert assignment one line below Init
    edits.push(vscode.TextEdit.insert(
      new vscode.Position(initLine + 1, 0),
      `    ${def.name} = ${assignPath}\n`
    ));
  }

  return edits;
}

export function deactivate() {
  // nothing
}
