"use strict";

import * as fs from 'fs-extra';
import { GotBodyOptions } from 'got';
import * as iconv from 'iconv-lite';
import * as path from 'path';
import { Readable, Stream } from 'stream';
import * as url from 'url';
import { Uri, window } from 'vscode';
import { RequestHeaders, ResponseHeaders } from '../models/base';
import { RestClientSettings } from '../models/configurationSettings';
import { HostCertificate } from '../models/hostCertificate';
import { HttpRequest } from '../models/httpRequest';
import { HttpResponse } from '../models/httpResponse';
import { HttpResponseTimingPhases } from '../models/httpResponseTimingPhases';
import { digest } from './auth/digest';
import { MimeUtility } from './mimeUtility';
import { base64, getHeader, hasHeader } from './misc';
import { PersistUtility } from './persistUtility';
import { getCurrentHttpFileName, getWorkspaceRootPath } from './workspaceUtility';

import got = require('got');

const encodeUrl = require('encodeurl');
const { CookieJar } = require('tough-cookie');
const cookieStore = require('tough-cookie-file-store-bugfix');

export class HttpClient {
    private readonly _settings: RestClientSettings = RestClientSettings.Instance;

    public constructor() {
        PersistUtility.ensureCookieFile();
    }

    public async send(httpRequest: HttpRequest): Promise<HttpResponse> {
        const options = await this.prepareOptions(httpRequest);

        let bodySize = 0;
        let headersSize = 0;
        const requestUrl = encodeUrl(httpRequest.url);
        const request = got(requestUrl, options);
        (request as any).on('response', res => {
            if (res.rawHeaders) {
                headersSize += res.rawHeaders.map(h => h.length).reduce((a, b) => a + b, 0);
                headersSize += (res.rawHeaders.length) / 2;
            }
            res.on('data', chunk => {
                bodySize += chunk.length;
            });
        });

        const response = await request;

        const contentType = response.headers['content-type'];
        let encoding: string | undefined;
        if (contentType) {
            encoding = MimeUtility.parse(contentType).charset;
        }

        if (!encoding) {
            encoding = "utf8";
        }

        const bodyBuffer = response.body;
        let bodyString: string;
        try {
            bodyString = iconv.decode(bodyBuffer, encoding);
        } catch {
            if (encoding !== 'utf8') {
                bodyString = iconv.decode(bodyBuffer, 'utf8');
            }
        }

        if (this._settings.decodeEscapedUnicodeCharacters) {
            bodyString = this.decodeEscapedUnicodeCharacters(bodyString!);
        }

        // adjust response header case, due to the response headers in nodejs http module is in lowercase
        const headersDic = HttpClient.getResponseRawHeaderNames(response.rawHeaders);
        const adjustedResponseHeaders: ResponseHeaders = {};
        for (const header in response.headers) {
            const adjustedHeaderName = headersDic[header] || header;
            adjustedResponseHeaders[adjustedHeaderName] = response.headers[header];
        }

        const requestBody = options.body;

        return new HttpResponse(
            response.statusCode,
            response.statusMessage,
            response.httpVersion,
            adjustedResponseHeaders,
            bodyString!,
            bodySize,
            headersSize,
            bodyBuffer,
            new HttpResponseTimingPhases(
                response.timings.phases.total,
                response.timings.phases.wait,
                response.timings.phases.dns,
                response.timings.phases.tcp,
                response.timings.phases.request,
                (response.timings.phases as any).firstByte,     // typo bug in @types/got
                response.timings.phases.download
            ),
            new HttpRequest(
                options.method!,
                requestUrl,
                HttpClient.capitalizeHeaderName((response as any).request.gotOptions.headers),
                Buffer.isBuffer(requestBody) ? this.convertBufferToStream(requestBody) : requestBody,
                httpRequest.rawBody,
                httpRequest.requestVariableCacheKey
            ));
    }

    private async prepareOptions(httpRequest: HttpRequest): Promise<GotBodyOptions<null>> {
        const originalRequestBody = httpRequest.body;
        let requestBody: string | Buffer | undefined;
        if (originalRequestBody) {
            if (typeof originalRequestBody !== 'string') {
                requestBody = await this.convertStreamToBuffer(originalRequestBody);
            } else {
                requestBody = originalRequestBody;
            }
        }

        const options: GotBodyOptions<null> = {
            headers: httpRequest.headers,
            method: httpRequest.method,
            body: requestBody,
            encoding: null,
            followRedirect: this._settings.followRedirect,
            cookieJar: this._settings.rememberCookiesForSubsequentRequests ? new CookieJar(new cookieStore(PersistUtility.cookieFilePath)) : undefined,
            rejectUnauthorized: false,
            throwHttpErrors: false
        };

        if (this._settings.timeoutInMilliseconds > 0) {
            options.timeout = this._settings.timeoutInMilliseconds;
        }

        if (!options.headers) {
            options.headers = httpRequest.headers = {};
        }

        // TODO: refactor auth
        const authorization = getHeader(options.headers, 'Authorization') as string | undefined;
        if (authorization) {
            const [scheme, user, ...args] = authorization.split(/\s+/);
            if (args.length > 0) {
                const pass = args.join(' ');
                if (scheme === 'Basic') {
                    options.headers!['Authorization'] = `Basic ${base64(`${user}:${pass}`)}`;
                } else if (scheme === 'Digest') {
                    options.hooks = { afterResponse: [digest(user, pass)] };
                }
            }
        }

        // set certificate
        const certificate = this.getRequestCertificate(httpRequest.url);
        if (certificate) {
            options.cert = certificate.cert;
            options.key = certificate.key;
            options.pfx = certificate.pfx;
            options.passphrase = certificate.passphrase;
        }

        // set proxy
        if (this._settings.proxy && !HttpClient.ignoreProxy(httpRequest.url, this._settings.excludeHostsForProxy)) {
            const proxyEndpoint = url.parse(this._settings.proxy);
            if (/^https?:$/.test(proxyEndpoint.protocol || '')) {
                const proxyOptions = {
                    host: proxyEndpoint.hostname,
                    port: Number(proxyEndpoint.port),
                    rejectUnauthorized: this._settings.proxyStrictSSL
                };

                const ctor = (httpRequest.url.startsWith('http:')
                    ? await import('http-proxy-agent')
                    : await import('https-proxy-agent')).default;

                options.agent = new ctor(proxyOptions);
            }
        }

        // add default headers if not specified
        for (const header in this._settings.defaultHeaders) {
            if (!hasHeader(options.headers, header) && (header.toLowerCase() !== 'host' || httpRequest.url[0] === '/')) {
                const value = this._settings.defaultHeaders[header];
                if (value) {
                    options.headers[header] = value;
                }
            }
        }

        const acceptEncoding = getHeader(options.headers, 'Accept-Encoding') as string | undefined;
        if (acceptEncoding && acceptEncoding.includes('gzip')) {
            options.decompress = true;
        }

        return options;
    }

    private async convertStreamToBuffer(stream: Stream): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const buffers: Buffer[] = [];
            stream.on('data', buffer => buffers.push(typeof buffer === 'string' ? Buffer.from(buffer) : buffer));
            stream.on('end', () => resolve(Buffer.concat(buffers)));
            stream.on('error', error => reject(error));
            (<any>stream).resume();
        });
    }

    private convertBufferToStream(buffer: Buffer): Stream {
        return new Readable({
            read() {
                this.push(buffer);
                this.push(null);
            }
        });
    }

    private decodeEscapedUnicodeCharacters(body: string): string {
        return body.replace(/\\u([\d\w]{4})/gi, (_, g) => String.fromCharCode(parseInt(g, 16)));
    }

    private getRequestCertificate(requestUrl: string): HostCertificate | null {
        const host = url.parse(requestUrl).host;
        if (!host) {
            return null;
        }

        if (host in this._settings.hostCertificates) {
            const certificate = this._settings.hostCertificates[host];
            let cert: Buffer | undefined,
                key: Buffer | undefined,
                pfx: Buffer | undefined;
            if (certificate.cert) {
                const certPath = HttpClient.resolveCertificateFullPath(certificate.cert, "cert");
                if (certPath) {
                    cert = fs.readFileSync(certPath);
                }
            }
            if (certificate.key) {
                const keyPath = HttpClient.resolveCertificateFullPath(certificate.key, "key");
                if (keyPath) {
                    key = fs.readFileSync(keyPath);
                }
            }
            if (certificate.pfx) {
                const pfxPath = HttpClient.resolveCertificateFullPath(certificate.pfx, "pfx");
                if (pfxPath) {
                    pfx = fs.readFileSync(pfxPath);
                }
            }
            return new HostCertificate(cert, key, pfx, certificate.passphrase);
        }

        return null;
    }

    private static getResponseRawHeaderNames(rawHeaders: string[]): { [key: string]: string } {
        const result: { [key: string]: string } = {};
        rawHeaders.forEach(header => {
            result[header.toLowerCase()] = header;
        });
        return result;
    }

    private static ignoreProxy(requestUrl: string, excludeHostsForProxy: string[]): Boolean {
        if (!excludeHostsForProxy || excludeHostsForProxy.length === 0) {
            return false;
        }

        const resolvedUrl = url.parse(requestUrl);
        const hostName = resolvedUrl.hostname && resolvedUrl.hostname.toLowerCase();
        const port = resolvedUrl.port;
        const excludeHostsProxyList = Array.from(new Set(excludeHostsForProxy.map(eh => eh.toLowerCase())));

        for (const eh of excludeHostsProxyList) {
            const urlParts = eh.split(":");
            if (!port) {
                // if no port specified in request url, host name must exactly match
                if (urlParts.length === 1 && urlParts[0] === hostName) {
                    return true;
                }
            } else {
                // if port specified, match host without port or hostname:port exactly match
                const [ph, pp] = urlParts;
                if (ph === hostName && (!pp || pp === port)) {
                    return true;
                }
            }
        }

        return false;
    }

    private static resolveCertificateFullPath(absoluteOrRelativePath: string, certName: string): string | undefined {
        if (path.isAbsolute(absoluteOrRelativePath)) {
            if (!fs.existsSync(absoluteOrRelativePath)) {
                window.showWarningMessage(`Certificate path ${absoluteOrRelativePath} of ${certName} doesn't exist, please make sure it exists.`);
                return undefined;
            } else {
                return absoluteOrRelativePath;
            }
        }

        // the path should be relative path
        const rootPath = getWorkspaceRootPath();
        let absolutePath = '';
        if (rootPath) {
            absolutePath = path.join(Uri.parse(rootPath).fsPath, absoluteOrRelativePath);
            if (fs.existsSync(absolutePath)) {
                return absolutePath;
            } else {
                window.showWarningMessage(`Certificate path ${absoluteOrRelativePath} of ${certName} doesn't exist, please make sure it exists.`);
                return undefined;
            }
        }

        const currentFilePath = getCurrentHttpFileName();
        if (!currentFilePath) {
            return undefined;
        }

        absolutePath = path.join(path.dirname(currentFilePath), absoluteOrRelativePath);
        if (fs.existsSync(absolutePath)) {
            return absolutePath;
        } else {
            window.showWarningMessage(`Certificate path ${absoluteOrRelativePath} of ${certName} doesn't exist, please make sure it exists.`);
            return undefined;
        }
    }

    private static capitalizeHeaderName(headers: RequestHeaders): RequestHeaders {
        const normalizedHeaders = {};
        if (headers) {
            for (const header in headers) {
                const capitalizedName = header.replace(/([^-]+)/g, h => h.charAt(0).toUpperCase() + h.slice(1));
                normalizedHeaders[capitalizedName] = headers[header];
            }
        }

        return normalizedHeaders;
    }
}
