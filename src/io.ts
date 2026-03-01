import * as vscode from 'vscode'; 

export async function readFileAsString(uri: vscode.Uri): Promise<string> {
    const data = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(data);
}

export async function writeFileFromString(uri: vscode.Uri, content: string): Promise<void> {
    const data = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, data);
}