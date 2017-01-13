"use strict";

import { window, Uri, workspace } from 'vscode';
import { ResponseStore } from '../responseStore';
import { HttpResponse } from '../models/httpResponse';
import { PersistUtility } from '../persistUtility';
import { Telemetry } from '../telemetry';
import * as Constants from '../constants';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

var cp = require('copy-paste');

export class ResponseController {
    public static responseSaveFolderPath: string = path.join(os.homedir(), Constants.ExtensionFolderName, Constants.DefaultResponseDownloadFolderName);

    public static async save(uri: Uri) {
        Telemetry.sendEvent('Response-Save');
        if (!uri) {
            return;
        }
        let response = ResponseStore.get(uri.toString());
        if (response !== undefined) {
            let fullResponse = ResponseController.getFullResponseString(response);
            let filePath = path.join(ResponseController.responseSaveFolderPath, `Response-${Date.now()}.http`)
            try {
                await PersistUtility.createFileIfNotExists(filePath);
                fs.writeFileSync(filePath, fullResponse);
                window.showInformationMessage(`Saved to ${filePath}`, { title: 'Open' }, { title: 'Copy Path' }).then(function (btn) {
                    if (btn) {
                        if (btn.title === 'Open') {
                            workspace.openTextDocument(filePath).then(window.showTextDocument);
                        } else if (btn.title === 'Copy Path') {
                            cp.copy(filePath);
                        }
                    }
                });
            } catch (error) {
                window.showErrorMessage(`Failed to save latest response to ${filePath}`);
            }
        }
    }

    public dispose() {
    }

    private static getFullResponseString(response: HttpResponse): string {
        let statusLine = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}${os.EOL}`;
        let headerString = '';
        for (var header in response.headers) {
            if (response.headers.hasOwnProperty(header)) {
                headerString += `${header}: ${response.headers[header]}${os.EOL}`;
            }
        }
        let body = '';
        if (response.body) {
            body = `${os.EOL}${response.body}`;
        }
        return `${statusLine}${headerString}${body}`;
    }
}